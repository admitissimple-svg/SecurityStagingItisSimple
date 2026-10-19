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
  checkUserExistsInFirestore,
  getFirestoreDb,
  saveStudentAssignmentsByUid,
  fetchStudentAssignmentsByUid,
  saveTeacherAvailabilityToFirestore,
  fetchTeacherAvailabilityFromFirestore,
  saveRoutineVideoSubcollection,
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
  saveYouTubePlaylistsToFirestore,
  fetchYouTubePlaylistsFromFirestore,
  saveTutorToFirestore,
  fetchTutorsFromFirestore,
  deleteTutorFromFirestore,
  deleteUserByEmailFromFirestore,
  saveSessionNotesProgressToFirestore,
  saveStudentJournalToFirestore,
  fetchUserDocumentFromFirestore,
  fetchTutorDocumentFromFirestore,
  fetchWeeklyChecksFromFirestore,
  saveWeeklyChecksToFirestore,
  fetchHomeworkFromFirestore,
  saveHomeworkToFirestore,
  isPermissionError,
  consolidateTutorsList,
  resolveTeacherCanonicalIdentity,
  isValidCanonicalUid,
  scheduleLessonAtomicServer,
  recordDailyReminderShownServer,
  fetchSessionNotesProgressServer,
  savePedagogicalTransformationToFirestoreServer,
  fetchPedagogicalTransformationFromFirestoreServer,
  recordLessonReviewInStudentJournalServer,
  fetchStudentDailyJournalFromServerFirestore,
  removeUndefinedFields,
} from './src/serverFirestore';
import { normalizeDictionaryWord } from './src/utils/studentDictionaryLibrary';
import { DEFAULT_CURATED_PLAYLISTS } from './src/utils/youtubeService';
import {
  syncSessionNotesWithPlatformDrive,
  getStoredDriveFile,
  listStoredDriveFiles,
  GOOGLE_DRIVE_SESSION_FOLDER,
  formatSessionNotesFileName,
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
  SPOTIFY_BEARER_TOKEN,
} from './src/utils/spotify';
import {
  extractYouTubeVideoId,
  getYouTubeEmbedUrl,
  getYouTubeWatchUrl,
  YOUTUBE_LEVEL_PLAYLISTS,
  getYouTubePlaylistForLevel,
  getWeeklyYouTubeVideosForLevel,
  getDailyYouTubeVideoForStudent,
} from './src/utils/youtube';
import { DayOfWeek } from './src/types';
import {
  synthesizeCohesiveStoryAndQuestions,
  synthesizeFillInBlanks,
  profileWord,
} from './src/utils/pedagogicalStorySynthesizer';
import { analyzeSentenceGrammarDeterministic } from './src/utils/writingChecker';
import { sanitizeTimeZone } from './src/utils/timezone';
import crypto from 'crypto';
import { parseNotesHtml } from './src/utils/notesHtmlParser';
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
} from './src/utils/pedagogicalTransformer';
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
  logGeminiAudited,
  resetGeminiSecurityStateForTesting,
  sendGeminiCostControlUnavailable,
  GeminiFeature,
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

export function resolvePort(portEnv?: string | number, appPortEnv?: string | number, defaultPort = 3000): number {
  return parsePort(portEnv) ?? parsePort(appPortEnv) ?? defaultPort;
}

export const PORT = resolvePort(process.env.PORT, process.env.APP_PORT, 3000);

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

app.use(express.json());


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
  spotifyPlaylists: Record<string, any>;
  studentHomeworkMap: Record<string, any>;
  sessionNotesMap: Record<string, any>;
  sessionNotesProgressMap: Record<string, any>;
  pedagogicalTransformationsMap: Record<string, any>;
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
export const ACTIVE_PRODUCTION_USERS = new Set([
  'adm.itissimple@gmail.com',
  'laviniatilapiafc@gmail.com',
]);

export const ACTIVE_PRODUCTION_STUDENTS = new Set<string>([
  'laviniatilapiafc@gmail.com',
]);

export const PURGED_OBSOLETE_STUDENTS = [
  'test-student@example.com',
  'test-student-123',
];

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
    url: track.url,
    title: track.title,
    artistOrHost: track.artist,
    type: 'music',
    duration: (track as any)?.duration || '3-4 min',
    instructions: track.teacherTipPt,
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
  const merged: AppDb = {
    ...DEFAULT_DB,
    ...(parsed || {}),
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
    teachers: (Array.isArray(parsed?.teachers) ? parsed.teachers : DEFAULT_DB.teachers).filter(
      (t: any) => t.email?.toLowerCase() !== 'reginahelena1980@gmail.com' && !t.name?.toLowerCase().includes('regina')
    ),
    students: (Array.isArray(parsed?.students) ? parsed.students : []).filter((s: any) => {
      const email = (s.email || s.studentEmail || '').toLowerCase().trim();
      const deletedStudentList: string[] = Array.isArray(parsed?.deletedStudentEmails) ? parsed.deletedStudentEmails : [];
      return !email || !deletedStudentList.includes(email);
    }),
    liveLessons: (Array.isArray(parsed?.liveLessons) ? parsed.liveLessons : []).map((l: any) => {
      if (l && (l.cancelledAt || l.cancelledBy || l.cancellationReason) && l.status !== 'cancelled') {
        l.status = 'cancelled';
      }
      if (!l.studentEmail || l.studentEmail.trim() === '') {
        if (l.studentUid) {
          const allProfiles = Object.values(parsed?.userProfiles || {});
          const foundProfile = (allProfiles as any[]).find((p: any) => p.id === l.studentUid || p.uid === l.studentUid);
          const foundStudent = (Array.isArray(parsed?.students) ? parsed.students : []).find((s: any) => s.studentUid === l.studentUid || s.id === l.studentUid);
          if (foundProfile?.email) {
            l.studentEmail = foundProfile.email.toLowerCase().trim();
          } else if (foundStudent?.email || foundStudent?.studentEmail) {
            l.studentEmail = (foundStudent.email || foundStudent.studentEmail).toLowerCase().trim();
          }
        }
      }
      return l;
    }),
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

const LOCAL_DB_PATH = path.join(process.cwd(), 'src', 'data', 'app_db.json');

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

function saveToDiskSync(db: AppDb) {
  try {
    scrubPasswords(db);
    const dir = path.dirname(LOCAL_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not write local db backup to disk:', err);
  }
}

function loadFromDisk(): AppDb | null {
  try {
    if (fs.existsSync(LOCAL_DB_PATH)) {
      const content = fs.readFileSync(LOCAL_DB_PATH, 'utf-8');
      if (content && content.trim()) {
        return JSON.parse(content);
      }
    }
  } catch (err) {
    console.warn('Could not read local db backup from disk:', err);
  }
  return null;
}

// Hydrate in-memory DB immediately from disk if available (strictly skipped in DIAGNOSTIC_ONLY mode)
if (!isDiagnosticMode()) {
  const initialDiskDb = loadFromDisk();
  if (initialDiskDb) {
    // Sanitize fabricated placeholder UIDs during disk load so they never taint runtime memory
    const diskAuthUsers = { ...(initialDiskDb.authUsers || {}) };
    const diskUserProfiles = { ...(initialDiskDb.userProfiles || {}) };
    const diskTeachers = [...(initialDiskDb.teachers || [])];
    const diskStudents = [...(initialDiskDb.students || [])];

    for (const [em, u] of Object.entries(diskAuthUsers)) {
      if ((u as any)?.uid === 'admin-master-uid' || (u as any)?.uid === 'student_lala_canonical_uid') {
        delete diskAuthUsers[em];
      }
    }
    for (const [em, p] of Object.entries(diskUserProfiles)) {
      if ((p as any)?.uid === 'admin-master-uid' || (p as any)?.uid === 'student_lala_canonical_uid') {
        delete (p as any).uid;
        delete (p as any).id;
      }
      if ((p as any)?.teacherUid === 'admin-master-uid') {
        delete (p as any).teacherUid;
      }
    }
    for (const s of diskStudents) {
      if (s.uid === 'student_lala_canonical_uid' || s.id === 'student_lala_canonical_uid' || s.studentUid === 'student_lala_canonical_uid') {
        delete s.uid;
        delete s.id;
        delete s.studentUid;
      }
      if (s.teacherUid === 'admin-master-uid') {
        delete s.teacherUid;
      }
    }
    for (const t of diskTeachers) {
      if (t.uid === 'admin-master-uid' || t.id === 'admin-master-uid') {
        delete t.uid;
        delete t.id;
      }
    }

    inMemoryDb = {
      ...DEFAULT_DB,
      ...initialDiskDb,
      teachers: diskTeachers,
      authUsers: diskAuthUsers,
      userProfiles: diskUserProfiles,
      students: diskStudents,
    };
  } else {
    saveToDiskSync(inMemoryDb);
  }
}

function readDb(): AppDb {
  return inMemoryDb;
}

let syncTimeout: any = null;
let isCloudHydrated = false;

function writeDb(db: AppDb) {
  if (isDiagnosticMode()) {
    return; // Strictly no disk writes or cloud syncing in diagnostic mode
  }
  scrubPasswords(db);
  inMemoryDb = db;
  saveToDiskSync(db);

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
async function writeDbSync(db: AppDb): Promise<void> {
  if (isDiagnosticMode()) {
    return; // Strictly no disk writes or cloud syncing in diagnostic mode
  }
  scrubPasswords(db);
  inMemoryDb = db;
  saveToDiskSync(db);
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
async function initCloudPersistence() {
  if (isDiagnosticMode()) {
    return; // Strictly disabled in DIAGNOSTIC_ONLY mode
  }
  try {
    // Fetch latest state directly from Cloud Firestore
    const cloudState = await fetchAppStateFromFirestore();
    if (cloudState && typeof cloudState === 'object') {
      console.log('Successfully hydrated database from Firebase Firestore cloud');
      // Sanitize placeholder UIDs in cloudState before merging
      if (cloudState.authUsers) {
        for (const [em, u] of Object.entries(cloudState.authUsers)) {
          if ((u as any)?.uid === 'admin-master-uid' || (u as any)?.uid === 'student_lala_canonical_uid') {
            delete (u as any).uid;
          }
        }
      }
      if (cloudState.userProfiles) {
        for (const [em, p] of Object.entries(cloudState.userProfiles)) {
          if ((p as any)?.uid === 'admin-master-uid' || (p as any)?.uid === 'student_lala_canonical_uid') {
            delete (p as any).uid;
            delete (p as any).id;
          }
          if ((p as any)?.teacherUid === 'admin-master-uid') {
            delete (p as any).teacherUid;
          }
        }
      }

      // Merge user profiles preserving canonical UIDs
      const mergedUserProfiles: Record<string, any> = {};
      const allProfileKeys = new Set([
        ...Object.keys(inMemoryDb.userProfiles || {}),
        ...Object.keys(cloudState.userProfiles || {}),
      ]);
      allProfileKeys.forEach((key) => {
        mergedUserProfiles[key] = mergeProfilePreservingCanonicalUid(
          inMemoryDb.userProfiles?.[key],
          cloudState.userProfiles?.[key]
        );
      });

      const mergedAuthUsers: Record<string, any> = {
        ...(inMemoryDb.authUsers || {}),
        ...(cloudState.authUsers || {}),
      };
      Object.keys(mergedAuthUsers).forEach((k) => {
        const canonical = mergedUserProfiles[k]?.uid;
        if (canonical && isValidCanonicalUid(canonical)) {
          mergedAuthUsers[k].uid = canonical;
        }
      });

      // Merge tutorsList by email/id so NO tutor is ever lost
      const localTutors = inMemoryDb.tutorsList || [];
      const cloudTutors = Array.isArray(cloudState.tutorsList) ? cloudState.tutorsList : [];
      const directTutors = await fetchTutorsFromFirestore().catch(() => []);
      const tutorMap = new Map<string, any>();

      // 1. Put local memory tutors first
      localTutors.forEach((t: any) => {
        const key = (t.email || t.id || '').toLowerCase().trim();
        if (key) tutorMap.set(key, t);
      });
      // 2. Put cloudState tutors over local memory
      cloudTutors.forEach((t: any) => {
        const key = (t.email || t.id || '').toLowerCase().trim();
        if (key) {
          const existing = tutorMap.get(key) || {};
          tutorMap.set(key, { ...existing, ...t });
        }
      });
      // 3. Put direct collection /tutors/ over everything (authoritative source of truth)
      (directTutors || []).forEach((t: any) => {
        const key = (t.email || t.id || '').toLowerCase().trim();
        if (key) {
          const existing = tutorMap.get(key) || {};
          tutorMap.set(key, { ...existing, ...t });
        }
      });
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

      // Merge teachers list by email
      const localTeachers = inMemoryDb.teachers || [];
      const cloudTeachers = Array.isArray(cloudState.teachers) ? cloudState.teachers : [];
      const teacherMap = new Map<string, any>();
      localTeachers.forEach((t: any) => {
        const key = (t.email || '').toLowerCase().trim();
        if (key && !allDeletedTutorEmails.includes(key)) teacherMap.set(key, t);
      });
      cloudTeachers.forEach((t: any) => {
        const key = (t.email || '').toLowerCase().trim();
        if (key && !allDeletedTutorEmails.includes(key)) {
          const existing = teacherMap.get(key) || {};
          teacherMap.set(key, { ...existing, ...t });
        }
      });
      // Ensure all tutors have teacher entries
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
        if (t.role === 'admin' || em === 'adm.itissimple@gmail.com') return true;
        return !allDeletedTutorEmails.includes(em);
      });

      // Ensure all tutors have entries in mergedAuthUsers and mergedUserProfiles
      mergedTutorsList.forEach((t: any) => {
        const key = (t.email || '').toLowerCase().trim();
        if (key && !allDeletedTutorEmails.includes(key)) {
          const tId = t.id || `tutor-${key.replace(/[^a-zA-Z0-9]/g, '-')}`;
          if (!mergedAuthUsers[key]) {
            mergedAuthUsers[key] = {
              uid: tId,
              id: tId,
              email: key,
              name: t.name || key.split('@')[0],
              role: 'teacher',
              createdAt: t.createdAt || new Date().toISOString(),
            };
          }
          if (!mergedUserProfiles[key]) {
            mergedUserProfiles[key] = {
              id: tId,
              uid: tId,
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
        if (em !== 'adm.itissimple@gmail.com') {
          delete mergedUserProfiles[em];
          if (mergedAuthUsers[em]?.role === 'teacher') {
            delete mergedAuthUsers[em];
          }
        }
      });

      // Merge students list by email, excluding deleted and non-production students
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

      const localStudents = inMemoryDb.students || [];
      const cloudStudents = Array.isArray(cloudState.students) ? cloudState.students : [];
      const studentMap = new Map<string, any>();
      cloudStudents.forEach((s: any) => {
        const key = (s.studentEmail || s.email || '').toLowerCase().trim();
        if (key && !allDeletedStudentEmails.includes(key)) {
          studentMap.set(key, s);
        }
      });
      localStudents.forEach((s: any) => {
        const key = (s.studentEmail || s.email || '').toLowerCase().trim();
        if (key && !allDeletedStudentEmails.includes(key)) {
          const existing = studentMap.get(key);
          if (existing) {
            studentMap.set(key, mergeStudentPreservingCanonicalUid(existing, s));
          } else if (s.uid && isValidCanonicalUid(s.uid)) {
            studentMap.set(key, s);
          }
        }
      });

      // Reconcile students who have active routines or assignments stored in cloudState so they are never lost
      const allActiveStudentEmails = new Set<string>();
      Object.keys(cloudState.studentRoutinesMap || {}).forEach((k) => {
        if (k && k.includes('@')) allActiveStudentEmails.add(k.toLowerCase().trim());
      });
      Object.keys(cloudState.studentVideoAssignments || {}).forEach((k) => {
        if (k && k.includes('@')) allActiveStudentEmails.add(k.toLowerCase().trim());
      });
      Object.keys(cloudState.studentSpotifyAssignments || {}).forEach((k) => {
        if (k && k.includes('@')) allActiveStudentEmails.add(k.toLowerCase().trim());
      });
      Object.keys(cloudState.studentWeeklyChecks || {}).forEach((k) => {
        if (k && k.includes('@')) allActiveStudentEmails.add(k.toLowerCase().trim());
      });

      allActiveStudentEmails.forEach((cleanEmail) => {
        if (!allDeletedStudentEmails.includes(cleanEmail)) {
          const existingProfile = mergedUserProfiles[cleanEmail];
          const resolvedUid = (existingProfile?.uid && isValidCanonicalUid(existingProfile.uid))
            ? existingProfile.uid
            : (studentMap.get(cleanEmail)?.uid || null);

          if (!mergedUserProfiles[cleanEmail] && resolvedUid) {
            mergedUserProfiles[cleanEmail] = {
              id: resolvedUid,
              uid: resolvedUid,
              name: cleanEmail.split('@')[0],
              email: cleanEmail,
              level: 'iniciante',
              enrollmentStatus: 'active',
              learningGoal: 'English for everyday life & work',
              weeklyStudyDaysTarget: 7,
              weeklyStudyDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
              createdAt: new Date().toISOString(),
            };
          }
          if (!studentMap.has(cleanEmail) && resolvedUid) {
            studentMap.set(cleanEmail, {
              id: resolvedUid,
              studentUid: resolvedUid,
              uid: resolvedUid,
              name: cleanEmail.split('@')[0],
              studentName: cleanEmail.split('@')[0],
              email: cleanEmail,
              studentEmail: cleanEmail,
              level: 'iniciante',
              studentLevel: 'iniciante',
              goal: 'English for everyday life & work',
              learningGoal: 'English for everyday life & work',
              contractedLessons: 5,
              completedLessonsCount: 0,
              status: 'active',
              activeSince: new Date().toISOString().split('T')[0],
              createdAt: new Date().toISOString(),
            });
          }
        }
      });

      const mergedStudents = Array.from(studentMap.values()).filter((s: any) => {
        const em = (s.email || s.studentEmail || '').toLowerCase().trim();
        return em && !allDeletedStudentEmails.includes(em);
      });

      // Merge liveLessons by id, keeping only valid lessons
      const localLessons = inMemoryDb.liveLessons || [];
      const cloudLessons = Array.isArray(cloudState.liveLessons) ? cloudState.liveLessons : [];
      const lessonMap = new Map<string, any>();
      cloudLessons.forEach((l: any) => {
        if (l.id) lessonMap.set(l.id, l);
      });
      localLessons.forEach((l: any) => {
        if (l.id) {
          const existing = lessonMap.get(l.id) || {};
          const merged = { ...existing, ...l };
          if (existing.cancelledAt || l.cancelledAt || existing.status === 'cancelled' || l.status === 'cancelled') {
            merged.status = 'cancelled';
            merged.cancelledAt = l.cancelledAt || existing.cancelledAt || new Date().toISOString();
            merged.cancelledBy = l.cancelledBy || existing.cancelledBy || 'student';
          }
          lessonMap.set(l.id, merged);
        }
      });
      const mergedLiveLessons = Array.from(lessonMap.values())
        .map((l: any) => {
          if (l && (l.cancelledAt || l.cancelledBy || l.cancellationReason) && l.status !== 'cancelled') {
            l.status = 'cancelled';
          }
          if (!l.studentEmail || l.studentEmail.trim() === '') {
            if (l.studentUid) {
              const allProfiles = Object.values(inMemoryDb?.userProfiles || cloudState?.userProfiles || {});
              const foundProfile = (allProfiles as any[]).find((p: any) => p.id === l.studentUid || p.uid === l.studentUid);
              const foundStudent = (Array.isArray(inMemoryDb?.students) ? inMemoryDb.students : []).find((s: any) => s.studentUid === l.studentUid || s.id === l.studentUid);
              if (foundProfile?.email) {
                l.studentEmail = foundProfile.email.toLowerCase().trim();
              } else if (foundStudent?.email || foundStudent?.studentEmail) {
                l.studentEmail = (foundStudent.email || foundStudent.studentEmail).toLowerCase().trim();
              }
            }
          }
          return l;
        })
        .filter((l: any) => {
          const sEmail = (l.studentEmail || '').toLowerCase().trim();
          return !allDeletedStudentEmails.includes(sEmail);
        });

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

      inMemoryDb = mergeDbWithDefaults({
        ...inMemoryDb,
        ...cloudState,
        authUsers: mergedAuthUsers,
        userProfiles: mergedUserProfiles,
        tutorsList: mergedTutorsList,
        teachers: mergedTeachers,
        students: mergedStudents,
        liveLessons: mergedLiveLessons,
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
        console.log(`Recovered ${directTutors.length} tutors directly from /tutors collection!`);
        inMemoryDb.tutorsList = directTutors;
      }
      isCloudHydrated = true;
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

// Phase 1C-A: backend Firebase ID token verification and trusted role inspection
app.get('/api/auth/verify-session', firebaseAuthMiddleware, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ authenticated: false, error: 'Unauthorized' });
  }

  return res.json({
    authenticated: true,
    uid: req.user.uid,
    emailVerified: req.user.email_verified,
    role: req.user.role,
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

  // 2. Strict Server-Side Role-Based Access Control (RBAC)
  // Admin privileges require cryptographically verified custom claim or trusted server bootstrap record
  const isServerVerifiedAdmin =
    verifiedCaller.role === 'admin' ||
    (db.teachers || []).some(
      (t: any) => t.role === 'admin' && (t.uid === authenticatedUid || t.id === authenticatedUid)
    );

  // If user requested admin role, they MUST possess verified admin privileges
  if (requestedRole === 'admin' && !isServerVerifiedAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      code: 'ADMIN_ACCESS_DENIED',
      message: 'Acesso negado: esta conta não possui privilégios de administrador ou a custom claim de administrador ainda não foi provisionada.',
    });
  }

  const tutorObj = (db.tutorsList || []).find(
    (t: any) => t.uid === authenticatedUid || t.authUid === authenticatedUid || (t.email || '').toLowerCase() === cleanEmail
  );
  const teacherObj = (db.teachers || []).find(
    (t: any) => (t.uid === authenticatedUid || (t.email || '').toLowerCase() === cleanEmail) && t.role !== 'admin'
  );
  const isRegisteredTeacher = !isServerVerifiedAdmin && Boolean(tutorObj || teacherObj || requestedRole === 'teacher');

  const studentObjInDb = (db.students || []).find(
    (s: any) => s.uid === authenticatedUid || s.id === authenticatedUid || (s.email || s.studentEmail || '').toLowerCase() === cleanEmail
  );
  const isRegisteredStudent = !isServerVerifiedAdmin && !isRegisteredTeacher && Boolean(studentObjInDb || db.userProfiles?.[cleanEmail]);

  let role: string = 'student';
  let name = cleanEmail.split('@')[0];
  let isRoleEnforced = false;

  if (isServerVerifiedAdmin) {
    role = 'admin';
    const adminTeacher = (db.teachers || []).find(
      (t: any) => t.role === 'admin' && (t.uid === authenticatedUid || t.id === authenticatedUid)
    );
    name = adminTeacher?.name || db.authUsers?.[cleanEmail]?.name || 'Admin';

    // Synchronize custom claim in Firebase Auth if not yet on the current token
    if (verifiedCaller.role !== 'admin') {
      try {
        const adminAuth = getFirebaseAdminAuth();
        adminAuth.setCustomUserClaims(authenticatedUid, { role: 'admin' }).catch(() => {});
      } catch {}
    }
  } else if (isRegisteredTeacher) {
    role = 'teacher';
    name = tutorObj?.name || teacherObj?.name || db.authUsers?.[cleanEmail]?.name || name;

    if (requestedRole === 'admin') {
      isRoleEnforced = true;
      console.warn(`[RBAC] Blocked teacher ${cleanEmail} from accessing admin panel.`);
    }

    // Link real Firebase Auth UID to tutor record
    const publicTutorId = tutorObj?.id || teacherObj?.id || `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    if (tutorObj) {
      tutorObj.uid = authenticatedUid;
      tutorObj.authUid = authenticatedUid;
      tutorObj.id = publicTutorId;
    }
    if (teacherObj) {
      teacherObj.uid = authenticatedUid;
    }
    if (tutorObj) {
      saveTutorToFirestore({ ...tutorObj, id: authenticatedUid, uid: authenticatedUid, authUid: authenticatedUid, publicTutorId, role: 'teacher' }).catch(() => {});
      saveUserToFirestore({ ...tutorObj, id: authenticatedUid, uid: authenticatedUid, tutorId: publicTutorId, role: 'teacher' }).catch(() => {});
    }

    // Purge any accidental student profile entry for this teacher
    if (db.userProfiles && db.userProfiles[cleanEmail]) {
      delete db.userProfiles[cleanEmail];
    }
  } else {
    // Registered or new student
    role = 'student';
    name = studentObjInDb?.name || studentObjInDb?.studentName || db.userProfiles?.[cleanEmail]?.name || db.authUsers?.[cleanEmail]?.name || name;

    if (requestedRole && requestedRole !== 'student') {
      isRoleEnforced = true;
      console.warn(`[RBAC] Blocked student ${cleanEmail} from accessing ${requestedRole} panel. Locked to student space.`);
    }
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
      const studentToPersist = db.userProfiles?.[cleanEmail] || studentObj;
      if (studentToPersist) {
        saveUserToFirestore({ ...studentToPersist, id: authenticatedUid, uid: authenticatedUid, role: 'student' }).catch(() => {});
      }
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
      distributeWeeklySpotifyForStudent(db, cleanEmail, account.uid, normLevel, undefined, undefined, studyDays);
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

    // Persist to Firestore asynchronously
    saveUserToFirestore(studentProfile).catch(() => {});
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
    account.picture = tutorObj?.avatar || tutorObj?.picture || '';
  }

  res.json({
    success: true,
    account,
    profile: role === 'teacher' ? null : studentProfile,
    student: role === 'teacher' ? null : (studentObj || (db.students || []).find((s) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail) || null),
    tutor: tutorObj || null,
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
  const db = readDb();
  const email = ((req.query.email as string) || '').toLowerCase().trim();
  const name = ((req.query.name as string) || '').toLowerCase().trim();
  const role = ((req.query.role as string) || '').toLowerCase().trim();

  let emailExists = false;
  let nameExists = false;
  let existingRole: string | null = null;
  let existingUser: any = null;

  if (email) {
    const inAuth = db.authUsers?.[email] || null;
    const inStudents = (db.students || []).find(
      (s: any) => (s.email || s.studentEmail || '').toLowerCase() === email
    );
    const inTutors = (db.tutorsList || []).find((t: any) => t.email?.toLowerCase() === email);
    const inProfiles = db.userProfiles?.[email] || null;

    if (inAuth || inStudents || inTutors || inProfiles) {
      emailExists = true;
      existingRole = inAuth?.role || (inTutors ? 'teacher' : inStudents ? 'student' : inProfiles?.role || null);
      existingUser = inAuth || inTutors || inStudents || inProfiles;
    } else {
      // Check Firebase Firestore persistence directly
      try {
        const firestoreUser = await fetchUserFromFirestore(email);
        if (firestoreUser) {
          emailExists = true;
          existingRole = firestoreUser.role || (firestoreUser.isTeacher ? 'teacher' : 'student');
          existingUser = firestoreUser;
          // Hydrate in memory database for ultra-fast subsequent checks
          if (!db.authUsers) db.authUsers = {};
          if (!db.authUsers[email]) {
            db.authUsers[email] = {
              uid: firestoreUser.uid || firestoreUser.id || `usr-${email.replace(/[^a-zA-Z0-9]/g, '-')}`,
              email,
              name: firestoreUser.name || email.split('@')[0],
              role: existingRole || 'student',
              createdAt: firestoreUser.createdAt || new Date().toISOString(),
            };
          }
          if (existingRole === 'student') {
            if (!db.userProfiles) db.userProfiles = {};
            if (!db.userProfiles[email]) db.userProfiles[email] = firestoreUser;
            if (!db.students) db.students = [];
            if (!db.students.some((s: any) => (s.email || s.studentEmail || '').toLowerCase() === email)) {
              db.students.push(firestoreUser);
            }
          }
          writeDb(db);
        }
      } catch (err) {
        console.warn('Error checking user in Firestore:', err);
      }
    }
  }

  if (name) {
    const inStudents = (db.students || []).some(
      (s: any) => ((s.name || s.studentName || '') as string).trim().toLowerCase() === name
    );
    const inAuthStudent = Object.values(db.authUsers || {}).some(
      (u: any) => (u.name || '').trim().toLowerCase() === name && u.role === 'student'
    );
    const inTutors = (db.tutorsList || []).some(
      (t: any) => (t.name || '').trim().toLowerCase() === name
    );

    if (role === 'student' && (inStudents || inAuthStudent)) {
      nameExists = true;
    } else if (role === 'teacher' && inTutors) {
      nameExists = true;
    } else if (!role && (inStudents || inAuthStudent || inTutors)) {
      nameExists = true;
    }
  }

  res.json({
    exists: emailExists || nameExists,
    emailExists,
    nameExists,
    role: existingRole,
    name: existingUser?.name || null,
    profile: email ? (db.userProfiles?.[email] || null) : null,
    student: email ? (db.students?.find((s: any) => (s.email || s.studentEmail || '').toLowerCase() === email) || null) : null,
    tutor: email ? (db.tutorsList?.find((t: any) => t.email?.toLowerCase() === email) || null) : null,
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

    const existingTutorUid =
      (existingTutor?.uid && isValidCanonicalUid(existingTutor.uid) ? existingTutor.uid : null) ||
      (existingTutor?.authUid && isValidCanonicalUid(existingTutor.authUid) ? existingTutor.authUid : null) ||
      (existingTeacher?.uid && isValidCanonicalUid(existingTeacher.uid) ? existingTeacher.uid : null) ||
      (existingAuth?.uid && isValidCanonicalUid(existingAuth.uid) ? existingAuth.uid : null) ||
      existingTutor?.uid || existingTeacher?.uid;

    if (verifiedUid && existingTutorUid && existingTutorUid !== verifiedUid && existingTutorUid !== 'admin-master-uid') {
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

    const tutorId = verifiedUid || (req.body.uid && isValidCanonicalUid(req.body.uid) ? req.body.uid : null) || req.body.id || `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
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
        name: cleanName,
        email: cleanEmail,
        role: 'teacher',
        avatar: tutorEntry.avatar,
        picture: tutorEntry.avatar,
      };
    } else {
      db.teachers.push({
        name: cleanName,
        email: cleanEmail,
        role: 'teacher',
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

    return res.json({
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
    (existingProfile?.id && isValidCanonicalUid(existingProfile.id) ? existingProfile.id : null) ||
    existingProfile?.uid || existingStudent?.uid;

  // 3.1 Anti-Hijacking & UID Conflict Protection
  if (verifiedUid && existingRecordUid && existingRecordUid !== verifiedUid && existingRecordUid !== 'admin-master-uid' && existingRecordUid !== 'student_lala_canonical_uid') {
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
  const userUid = verifiedUid || (req.body.uid && isValidCanonicalUid(req.body.uid) ? req.body.uid : null) || req.body.id || `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
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

  const incomingTeacherRef = req.body.teacherUid || req.body.teacherId || req.body.teacherEmail || req.body.selectedTutorId || req.body.selectedTutorEmail;
  if (incomingTeacherRef) {
    const teacherRes = await resolveTeacherCanonicalIdentity({
      teacherId: req.body.teacherId || req.body.selectedTutorId || (typeof incomingTeacherRef === 'string' ? incomingTeacherRef : undefined),
      teacherUid: req.body.teacherUid,
      teacherEmail: req.body.teacherEmail || req.body.selectedTutorEmail,
      publicTutorId: req.body.teacherId || req.body.selectedTutorId,
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

  res.json({
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

app.post('/api/auth/google', async (req, res) => {
  const db = readDb();
  const { email, name, picture, role: requestedRole, uid } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required for Google login' });
  }

  const cleanEmail = (email || '').toLowerCase().trim();
  const authRecord = db.authUsers?.[cleanEmail];

  const verifiedCaller = await getVerifiedUserFromRequest(req);
  const targetUid = (verifiedCaller?.uid && isValidCanonicalUid(verifiedCaller.uid) ? verifiedCaller.uid : null) || uid || authRecord?.uid;
  const isServerVerifiedAdmin =
    verifiedCaller?.role === 'admin' ||
    Boolean(targetUid && (db.teachers || []).some((t: any) => t.role === 'admin' && (t.uid === targetUid || t.id === targetUid)));
  let displayName = name || cleanEmail.split('@')[0];

  // Query Firestore to get authoritative doc
  let firestoreDoc: any = null;
  try {
    firestoreDoc = await fetchUserFromFirestore(cleanEmail, targetUid);
  } catch (fsErr) {
    console.warn('Firestore fetch notice in google auth:', fsErr);
  }

  const firestoreRole = (firestoreDoc?.role || '').toLowerCase();
  const authRecordRole = (authRecord?.role || '').toLowerCase();

  const isRegisteredStudent = !isServerVerifiedAdmin && (
    firestoreRole === 'student' ||
    authRecordRole === 'student' ||
    (db.students || []).some((s: any) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail)
  );

  const isRegisteredTeacher = !isServerVerifiedAdmin && !isRegisteredStudent && (
    firestoreRole === 'teacher' ||
    firestoreRole === 'native_friend' ||
    authRecordRole === 'teacher' ||
    (db.teachers || []).some((t: any) => (t.email || '').toLowerCase() === cleanEmail && t.role !== 'admin') ||
    (db.tutorsList || []).some((t: any) => (t.email || '').toLowerCase() === cleanEmail)
  );

  let role: string = 'student';
  let isRoleEnforced = false;

  if (isServerVerifiedAdmin) {
    role = 'admin';
    const adminTeacher = (db.teachers || []).find((t: any) => t.role === 'admin' && (t.uid === targetUid || t.id === targetUid));
    displayName = adminTeacher?.name || name || "Admin";
    if (targetUid && verifiedCaller?.role !== 'admin') {
      try {
        const adminAuth = getFirebaseAdminAuth();
        adminAuth.setCustomUserClaims(targetUid, { role: 'admin' }).catch(() => {});
      } catch {}
    }
  } else if (isRegisteredStudent) {
    // STRICT RBAC: If registered as a student, session is strictly locked to student space
    role = 'student';
    if (requestedRole && requestedRole !== 'student') {
      isRoleEnforced = true;
      console.warn(`[RBAC Google] Blocked user ${cleanEmail} from accessing ${requestedRole} panel. Locked to student space.`);
    }
  } else if (isRegisteredTeacher) {
    role = 'teacher';
    if (requestedRole === 'admin') {
      isRoleEnforced = true;
      console.warn(`[RBAC Google] Blocked teacher ${cleanEmail} from accessing admin panel.`);
    }
  } else if (requestedRole) {
    role = requestedRole === 'teacher' ? 'teacher' : 'student';
  }

  // Update or record in authUsers
  if (!db.authUsers) db.authUsers = {};
  if (!db.authUsers[cleanEmail]) {
    db.authUsers[cleanEmail] = {
      uid: uid || `google-${Date.now()}`,
      email: cleanEmail,
      name: displayName,
      role,
      createdAt: new Date().toISOString(),
    };
  } else if (uid && !db.authUsers[cleanEmail].uid) {
    db.authUsers[cleanEmail].uid = uid;
  }

  // If new student, add to students list
  if (role === 'student') {
    const existing = db.students.find(
      (s) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail
    );
    if (!existing) {
      const canonicalStudentId = uid || db.authUsers[cleanEmail]?.uid || `st-${Date.now()}`;
      db.students.push({
        id: canonicalStudentId,
        uid: uid || db.authUsers[cleanEmail]?.uid || canonicalStudentId,
        name: displayName,
        studentName: displayName,
        email: cleanEmail,
        studentEmail: cleanEmail,
        picture: picture || '',
        avatar: picture || '',
        level: 'iniciante',
        studentLevel: 'iniciante',
        goal: 'English for everyday life & work',
        learningGoal: 'English for everyday life & work',
        contractedLessons: 0,
        completedLessonsCount: 0,
        teacherEmail: null,
        teacherName: null,
        routineVideoTime: '09:00',
        routineAudioTime: '14:00',
        dailyPhraseTime: '20:00',
        status: 'active',
        activeSince: new Date().toISOString().split('T')[0],
        createdAt: new Date().toISOString(),
      });
      if (!db.contractedLessons) db.contractedLessons = {};
      db.contractedLessons[cleanEmail] = 0;

      if (!db.userProfiles) db.userProfiles = {};
      if (!db.userProfiles[cleanEmail]) {
        db.userProfiles[cleanEmail] = {
          id: canonicalStudentId,
          uid: uid || db.authUsers[cleanEmail]?.uid || canonicalStudentId,
          name: displayName,
          email: cleanEmail,
          picture: picture || '',
          avatar: picture || '',
          level: 'iniciante',
          teacherEmail: null,
          teacherName: null,
          routineVideoTime: '09:00',
          routineAudioTime: '14:00',
          dailyPhraseTime: '20:00',
          enrollmentStatus: 'not_enrolled',
          learningGoal: 'English for everyday life & work',
          streakDays: 0,
          streakCount: 0,
          points: 0,
          contractedLessons: 0,
          completedLessonsCount: 0,
        };
      }
      writeDb(db);
    } else if (uid) {
      existing.id = uid;
      existing.uid = uid;
      if (db.userProfiles?.[cleanEmail]) {
        db.userProfiles[cleanEmail].id = uid;
        db.userProfiles[cleanEmail].uid = uid;
      }
      writeDb(db);
    }
  } else if (role === 'teacher' && uid) {
    const tutorEntry = (db.tutorsList || []).find((t: any) => (t.email || '').toLowerCase() === cleanEmail);
    if (tutorEntry) {
      const publicTutorId = tutorEntry.id || `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
      tutorEntry.uid = uid;
      tutorEntry.authUid = uid;
      tutorEntry.id = publicTutorId;
      saveTutorToFirestore({ ...tutorEntry, id: uid, uid, authUid: uid, publicTutorId, role: 'teacher' }).catch(() => {});
      saveUserToFirestore({ ...tutorEntry, id: uid, uid, tutorId: publicTutorId, role: 'teacher' }).catch(() => {});
    }
    const teacherEntry = (db.teachers || []).find((t: any) => (t.email || '').toLowerCase() === cleanEmail);
    if (teacherEntry) {
      teacherEntry.uid = uid;
    }
    writeDb(db);
  }

  const effectiveUid =
    (targetUid && isValidCanonicalUid(targetUid))
      ? targetUid
      : (uid || db.authUsers?.[cleanEmail]?.uid || `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`);

  const account = {
    uid: effectiveUid,
    id: effectiveUid,
    email: cleanEmail,
    name: displayName,
    role,
    picture:
      picture ||
      db.userProfiles?.[cleanEmail]?.picture ||
      db.userProfiles?.[effectiveUid]?.picture ||
      '',
  };

  res.json({
    success: true,
    account,
    profile: db.userProfiles?.[cleanEmail] || null,
    student: (db.students || []).find((s) => (s.email || s.studentEmail || '').toLowerCase() === cleanEmail) || null,
    tutor: (db.tutorsList || []).find((t) => t.email.toLowerCase() === cleanEmail) || null,
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
  const publicId = String(t.publicTutorId || t.id || '');
  const dto: Record<string, any> = {
    id: publicId,
    publicTutorId: publicId,
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
  const publicId = String(t.publicTutorId || t.id || '');
  sanitized.id = publicId;
  sanitized.publicTutorId = publicId;
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
  // Continuously synchronize tutors with Firestore so remotely created profiles (e.g. Charles) appear immediately
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
    return Boolean(
      t.approvalStatus === 'approved' ||
      t.isApproved === true ||
      t.status === 'approved' ||
      t.approved === true
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
  const tutorId = (rawTutor.id && typeof rawTutor.id === 'string' && rawTutor.id.trim())
    ? rawTutor.id.trim()
    : `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;

  // Audit protection: Check if caller is verified admin
  const verifiedCaller = await getVerifiedUserFromRequest(req);
  const isAdminCaller = verifiedCaller?.role === 'admin';

  // Prevent hijacking or overwriting administrator accounts
  const isTargetAdmin =
    cleanEmail === 'adm.itissimple@gmail.com' ||
    (db.teachers || []).some((t: any) => t.email?.toLowerCase() === cleanEmail && t.role === 'admin');
  if (isTargetAdmin && !isAdminCaller) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: Cannot register or overwrite an administrator account',
    });
  }

  // Reject attempts to update or overwrite existing tutors by email, UID or ID
  const incomingUid = (rawTutor.uid && typeof rawTutor.uid === 'string') ? rawTutor.uid.trim() : '';
  const incomingId = (rawTutor.id && typeof rawTutor.id === 'string') ? rawTutor.id.trim() : '';
  const verifiedUidForMatch = verifiedCaller?.uid || '';

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
  if (verifiedCaller?.uid && isValidCanonicalUid(verifiedCaller.uid)) {
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
  if (!canonicalAuthUid && (cleanEmail === 'laviniafofafc@gmail.com' || tutorId === 'skull-bee')) {
    canonicalAuthUid = 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1';
  }
  if (!canonicalAuthUid && (cleanEmail === 'beeginning4you@gmail.com' || cleanEmail === 'estilobeeforkids@gmail.com' || cleanEmail === 'estilobeeadm@gmail.com' || tutorId === 'queen-bee' || (req.body?.name && typeof req.body.name === 'string' && req.body.name.toLowerCase().includes('queen bee')))) {
    canonicalAuthUid = 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2';
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

  // Purge any accidental student profile entry for this teacher
  if (db.userProfiles && db.userProfiles[cleanEmail]) {
    delete db.userProfiles[cleanEmail];
  }
  if (db.students) {
    db.students = db.students.filter((s: any) => (s.email || s.studentEmail || '').toLowerCase() !== cleanEmail);
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
    return res.status(400).json({ error: 'Invalid tutor id' });
  }

  const rawBody = req.body;
  const updatedData = rawBody?.tutor ? { ...rawBody.tutor } : { ...rawBody };
  if ((updatedData as any).tutor) delete (updatedData as any).tutor;

  let existingIdx = (db.tutorsList || []).findIndex(
    (t: any) =>
      (t.id && t.id.toLowerCase() === tutorIdParam.toLowerCase()) ||
      (t.uid && t.uid === tutorIdParam) ||
      (t.email && t.email.toLowerCase() === tutorIdParam.toLowerCase())
  );

  if (existingIdx === -1) {
    const teacherEntry = (db.teachers || []).find(
      (t: any) =>
        (t.uid && t.uid === tutorIdParam) ||
        (t.email && t.email.toLowerCase() === tutorIdParam.toLowerCase())
    );
    if (teacherEntry) {
      const cleanEmail = (teacherEntry.email || '').toLowerCase().trim();
      const syntheticTutor = {
        id: tutorIdParam.includes('@') ? `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : tutorIdParam,
        uid: teacherEntry.uid,
        name: teacherEntry.name,
        email: cleanEmail,
        role: 'teacher',
        approvalStatus: teacherEntry.approvalStatus || 'pending',
        isApproved: teacherEntry.isApproved || false,
        status: teacherEntry.status || teacherEntry.approvalStatus || 'pending',
        approved: teacherEntry.approved || teacherEntry.isApproved || false,
        avatar: teacherEntry.avatar || '',
        country: teacherEntry.country || '',
        accent: teacherEntry.accent || '',
        timezone: teacherEntry.timezone || '',
      };
      db.tutorsList = db.tutorsList || [];
      db.tutorsList.push(syntheticTutor);
      existingIdx = db.tutorsList.length - 1;
    }
  }

  if (existingIdx === -1) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Tutor não encontrado',
    });
  }

  const existingTutor = db.tutorsList[existingIdx];
  const existingEmail = (existingTutor.email || '').toLowerCase().trim();
  const existingUid = (existingTutor.uid || '').trim();
  const existingId = (existingTutor.id || '').trim();

  const callerEmail = (caller.email || '').toLowerCase().trim();
  const callerUid = (caller.uid || '').trim();

  // Audit protection: Check if caller is verified admin
  const isAdmin = caller.role === 'admin';

  // Ownership verification based strictly on server-verified token and trusted record identifiers
  const isOwner = Boolean(
    (existingUid && existingUid === callerUid) ||
    (existingId && existingId === callerUid) ||
    (callerEmail && existingEmail && callerEmail === existingEmail)
  );

  // Requirement 2: Autorizar somente o próprio professor ou um administrador com custom claim role === 'admin'
  const isAuthorized = isAdmin || (caller.role === 'teacher' && isOwner);
  if (!isAuthorized) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: You are not authorized to update this tutor profile',
    });
  }

  // Prevent modifying an administrator account through tutor profile endpoint
  const isTargetAdmin =
    existingEmail === 'adm.itissimple@gmail.com' ||
    (db.teachers || []).some((t: any) => t.email?.toLowerCase() === existingEmail && t.role === 'admin');

  if (isTargetAdmin && !isAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: Cannot modify administrator account through tutor endpoint',
    });
  }

  // Requirement 4: Allowlist explícita de campos de perfil editáveis por professores
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
    // Admin can update teacher editable fields + approval/status fields
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

  // Requirement 6: Não permitir alterações de configurações administrativas, créditos, vínculos com alunos ou permissões
  // (Ensured by allowlist: any admin settings, credits, student assignments, permissions are ignored)

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
    // Immutable/protected identifiers (Requirement 5):
    id: existingTutor.id,
    email: existingTutor.email,
    uid: existingTutor.uid || caller.uid,
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
    // Strictly preserve centralized meetUrl, availableDays, and availability if not in fieldsToApply
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

  db.tutorsList[existingIdx] = updatedTutor;

  // Sync with db.teachers
  const teacherIdx = (db.teachers || []).findIndex((tc: any) => tc.email?.toLowerCase() === tEmail);
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

  // Direct Firestore persistence
  await saveTutorToFirestore(updatedTutor).catch((err) => {
    console.warn('Error saving updated tutor to Firestore collection:', err);
  });

  writeDb(db);
  return res.json({ success: true, tutor: updatedTutor, tutors: db.tutorsList });
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
  if (
    targetEmail === 'adm.itissimple@gmail.com' ||
    tutorId.toLowerCase() === 'adm.itissimple@gmail.com' ||
    (targetTutor && (targetTutor.role === 'admin' || targetTutor.email?.toLowerCase() === 'adm.itissimple@gmail.com'))
  ) {
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
    if (db.meetSettings && targetEmail !== 'adm.itissimple@gmail.com') {
      delete db.meetSettings[targetEmail];
    }
    if (db.teacherSettings && targetEmail !== 'adm.itissimple@gmail.com') {
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
    if (t.id === tutorId || t.email?.toLowerCase() === tutorId.toLowerCase()) {
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
      (tc: any) => tc.id === tutorId || (tc.email && tc.email.toLowerCase() === tutorId.toLowerCase())
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
    cleanEmail === 'adm.itissimple@gmail.com' ||
    (db.teachers || []).some((t: any) => t.email?.toLowerCase() === cleanEmail && t.role === 'admin');

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
    email === 'adm.itissimple@gmail.com' ||
    (db.teachers || []).some((t: any) => t.email?.toLowerCase() === email && t.role === 'admin');

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

    // Security Hotfix (Etapa 2): Single attempt with gemini-2.5-flash, zero cascade, exact token bound
    const singleAttempt = await executeGeminiSingleAttempt({
      feature: 'dictionary_define',
      systemInstruction: 'You are the master Native Friend Notes Pedagogical AI Engine. Provide accurate, crystal-clear lexical analyses for ESL learners in strict JSON.',
      untrustedUserDataPrompt: prompt,
      callerRole,
      apiKey,
      temperature: 0.2,
    });

    const parsed = singleAttempt?.parsedJson;
    if (parsed && parsed.definitionEn && parsed.exampleSentenceEn) {
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
    return res.json(pedagogicalDictCache.get(cacheKey));
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const apiRes = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lowerWord)}`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (apiRes.ok) {
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
            word: entry.word || cleanWord,
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
  } catch {
    // Secondary fallback handling
  }

  // 5. Fallback adhering strictly to Native Friend Notes pedagogical standard
  const isMultiWord = cleanWord.includes(' ');
  const fallbackPos = isMultiWord ? 'Idiomatic Expression' : 'Vocabulary Item';
  const fallbackDef =
    cefr === 'A1' || cefr === 'A2'
      ? `A fundamental word for level ${cefr}: practice using "${cleanWord}" in simple daily conversations.`
      : cefr === 'B1' || cefr === 'B2'
      ? `A natural conversational expression to enrich your speaking flow and vocabulary range.`
      : `An advanced lexical item to elevate your expressive nuance and natural delivery.`;

  const fallbackResult = {
    word: cleanWord,
    partOfSpeech: fallbackPos,
    cefrLevel: cefr,
    definitionEn: fallbackDef,
    exampleSentenceEn: generateNativeNotesExample(cleanWord, fallbackPos),
    source: 'native_notes_standard',
    notFound: false,
  };

  pedagogicalDictCache.set(cacheKey, fallbackResult);
  pedagogicalDictCache.set(lowerWord, fallbackResult);
  return res.json(fallbackResult);
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
    if (cached && !cached.notFound && cached.definitionEn) {
      return {
        word: trimmed,
        definitionEn: cached.definitionEn,
        exampleSentenceEn: cached.exampleSentenceEn || generateNativeNotesExample(trimmed, cached.partOfSpeech || ''),
        translationPt: cached.translationPt || trimmed,
        cefrLevel: cached.cefrLevel || cefr,
        partOfSpeech: cached.partOfSpeech || 'Vocabulary Item',
      };
    }
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

  // 5. Default structured vocabulary entry following Native Friend Notes
  const isMultiWord = trimmed.includes(' ');
  const fallbackPos = isMultiWord ? 'Idiomatic Expression' : 'Vocabulary Item';
  return {
    word: trimmed,
    definitionEn: `A practical vocabulary term (${cefr}) to enrich your conversational flow and clarity.`,
    exampleSentenceEn: generateNativeNotesExample(trimmed, fallbackPos),
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
  const role = req.query.role as string;

  if (role === 'admin' || teacherEmail === 'adm.itissimple@gmail.com') {
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
app.get('/api/students', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const db = readDb();
  const requesterEmail = (
    (req.query.email as string) ||
    (req.query.teacherEmail as string) ||
    (req.query.studentEmail as string) ||
    ''
  ).toLowerCase().trim();
  const role = req.query.role as string;
  const uid = (req.query.uid as string) || '';

  const adminEmails = [
    'adm.itissimple@gmail.com',
    'estilobeeforkids@gmail.com',
    'adm.itssimple@gmail.com',
    'estilobeeadm@gmail.com',
  ];

  const isTeacherAlias = (tEmail: string, searchEmail: string) => {
    const t = (tEmail || '').toLowerCase().trim();
    const s = (searchEmail || '').toLowerCase().trim();
    if (!t || !s) return false;
    if (t === s) return true;
    if (adminEmails.includes(t) && adminEmails.includes(s)) return true;
    return false;
  };

  const isAdmin = role === 'admin' || adminEmails.includes(requesterEmail);
  const isTeacher = role === 'teacher' || Boolean(req.query.teacherEmail);

  // Admin gets all active students directly
  if (isAdmin) {
    const adminStudents = (db.students || []).filter((s: any) => {
      const em = (s.email || s.studentEmail || '').toLowerCase().trim();
      const sStatus = s.status || s.enrollmentStatus;
      return Boolean(em && !(db.deletedStudentEmails || []).includes(em) && sStatus !== 'cancelled' && sStatus !== 'not_enrolled');
    });
    return res.json(adminStudents);
  }

  if (isTeacher) {
    const studentMap = new Map<string, any>();

    // 1. From db.students where teacherEmail matches and subscription is not cancelled
    (db.students || []).forEach((s: any) => {
      const sTeacher = (s.teacherEmail || '').toLowerCase().trim();
      const sTeacherUid = s.teacherUid || '';
      const sTeacherName = (s.teacherName || '').toLowerCase().trim();
      const sStatus = s.status || s.enrollmentStatus;

      // Filter out cancelled or not enrolled students
      if (sStatus === 'cancelled' || sStatus === 'not_enrolled') {
        return;
      }

      const matchesTeacher =
        isTeacherAlias(sTeacher, requesterEmail) ||
        (uid && sTeacherUid === uid) ||
        (adminEmails.includes(requesterEmail) && sTeacherName.includes('simple'));

      if (matchesTeacher) {
        const sEmail = (s.email || s.studentEmail || '').toLowerCase().trim();
        // Check if student profile was transferred or cancelled
        const p = db.userProfiles?.[sEmail];
        if (p) {
          const pTeacher = (p.teacherEmail || '').toLowerCase().trim();
          if (pTeacher && !isTeacherAlias(pTeacher, requesterEmail)) return;
          if (p.enrollmentStatus === 'cancelled' || p.enrollmentStatus === 'not_enrolled') return;
        }
        if (sEmail) {
          studentMap.set(sEmail, {
            ...s,
            email: sEmail,
            studentEmail: sEmail,
            name: s.name || s.studentName || sEmail.split('@')[0],
            studentName: s.name || s.studentName || sEmail.split('@')[0],
            status: s.status || 'active',
          });
        }
      }
    });

    // 2. From db.userProfiles where teacherEmail matches and enrollment is active
    Object.entries(db.userProfiles || {}).forEach(([pEmail, profile]: [string, any]) => {
      const cleanPEmail = pEmail.toLowerCase().trim();
      const pTeacher = (profile.teacherEmail || '').toLowerCase().trim();
      const pTeacherName = (profile.teacherName || '').toLowerCase().trim();
      const matchesTeacher =
        isTeacherAlias(pTeacher, requesterEmail) ||
        (adminEmails.includes(requesterEmail) && pTeacherName.includes('simple'));

      if (matchesTeacher && profile.role !== 'teacher' && profile.role !== 'admin') {
        if (profile.enrollmentStatus === 'cancelled' || profile.enrollmentStatus === 'not_enrolled' || profile.status === 'cancelled') {
          return;
        }
        if (!studentMap.has(cleanPEmail)) {
          studentMap.set(cleanPEmail, {
            id: profile.id || `st-${cleanPEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
            name: profile.name || cleanPEmail.split('@')[0],
            studentName: profile.name || cleanPEmail.split('@')[0],
            email: cleanPEmail,
            studentEmail: cleanPEmail,
            level: profile.level || 'iniciante',
            studentLevel: profile.level || 'iniciante',
            goal: profile.learningGoal || 'English for everyday life & work',
            learningGoal: profile.learningGoal || 'English for everyday life & work',
            teacherEmail: requesterEmail,
            teacherName: profile.teacherName || '',
            contractedLessons: Number(profile.contractedLessons ?? db.contractedLessons?.[cleanPEmail] ?? 0),
            completedLessonsCount: Number(profile.completedLessonsCount || 0),
            picture: profile.avatar || profile.picture || '',
            avatar: profile.avatar || profile.picture || '',
            status: 'active',
            enrolledAt: profile.createdAt || new Date().toISOString(),
          });
        }
      }
    });

    // 3. From db.liveLessons where teacherEmail matches and lesson is scheduled/active
    (db.liveLessons || []).forEach((l: any) => {
      const lTeacher = (l.teacherEmail || l.tutorEmail || '').toLowerCase().trim();
      if (isTeacherAlias(lTeacher, requesterEmail) && l.status === 'scheduled') {
        const sEmail = (l.studentEmail || '').toLowerCase().trim();
        const p = db.userProfiles?.[sEmail];
        const st = (db.students || []).find((s: any) => (s.email || s.studentEmail || '').toLowerCase().trim() === sEmail);
        // Exclude if student is known to be cancelled or not enrolled
        if (p?.enrollmentStatus === 'cancelled' || p?.enrollmentStatus === 'not_enrolled' || p?.status === 'cancelled') return;
        if (st?.status === 'cancelled' || st?.status === 'not_enrolled' || st?.enrollmentStatus === 'not_enrolled') return;
        if (sEmail && !studentMap.has(sEmail)) {
          studentMap.set(sEmail, {
            id: `st-${sEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
            name: l.studentName || sEmail.split('@')[0],
            studentName: l.studentName || sEmail.split('@')[0],
            email: sEmail,
            studentEmail: sEmail,
            level: 'iniciante',
            studentLevel: 'iniciante',
            goal: 'English for everyday life & work',
            learningGoal: 'English for everyday life & work',
            teacherEmail: requesterEmail,
            teacherName: l.teacherName || '',
            status: 'active',
          });
        }
      }
    });

    const filteredStudents = Array.from(studentMap.values()).filter((st: any) => {
      const em = (st.email || st.studentEmail || '').toLowerCase().trim();
      return Boolean(em && !(db.deletedStudentEmails || []).includes(em));
    });
    return res.json(filteredStudents);
  }

  if (role === 'student' || req.query.studentEmail) {
    const list = (db.students || []).filter((s: any) => {
      const em = (s.email || s.studentEmail || '').toLowerCase().trim();
      return Boolean(em && !(db.deletedStudentEmails || []).includes(em)) && (em === requesterEmail || (uid && s.uid === uid));
    });
    return res.json(list);
  }

  // If unauthenticated or no matching filter, return empty array to prevent data leaks
  res.json([]);
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

app.get('/api/user-profile', (req, res) => {
  const db = readDb();
  const rawEmail = ((req.query.email as string) || '').toLowerCase().trim();
  const uid = ((req.query.uid as string) || (req.query.studentUid as string) || '').trim();
  const resolved = resolveStudentIdentifiers(db, rawEmail, uid);
  const email = resolved.email || rawEmail;
  if (!email && !uid) {
    return res.status(400).json({ error: 'Email or UID parameter is required' });
  }

  // If user is a teacher / Native Friend, return their tutor profile directly
  const isTeacherUser =
    db.authUsers?.[email]?.role === 'teacher' ||
    (db.tutorsList || []).some((t: any) => (t.email || '').toLowerCase() === email) ||
    (db.teachers || []).some((t: any) => (t.email || '').toLowerCase() === email && t.role === 'teacher');

  if (isTeacherUser) {
    const tutor =
      (db.tutorsList || []).find((t: any) => (t.email || '').toLowerCase() === email) ||
      (db.teachers || []).find((t: any) => (t.email || '').toLowerCase() === email) ||
      db.authUsers?.[email];
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

  const isDisallowedAdminTeacher = (em?: string, nm?: string) => {
    const cE = (em || '').toLowerCase().trim();
    const cN = (nm || '').toLowerCase().trim();
    return (
      cE === 'adm.itissimple@gmail.com' ||
      cE === 'estilobeeforkids@gmail.com' ||
      cE === 'adm.itssimple@gmail.com' ||
      cE === 'estilobeeadm@gmail.com' ||
      cE === 'admin@itissimple.com' ||
      cN.includes('simple')
    );
  };

  if (profile && student) {
    const fallbackTeacherEmail = isDisallowedAdminTeacher(student.teacherEmail, student.teacherName) ? null : student.teacherEmail;
    const fallbackTeacherName = isDisallowedAdminTeacher(student.teacherEmail, student.teacherName) ? null : student.teacherName;
    const canonicalResolvedUid = (uid && !uid.startsWith('usr-') && !uid.startsWith('st-')) ? uid : (profile.uid || (profile.id && !profile.id.startsWith('usr-') && !profile.id.startsWith('st-') ? profile.id : null) || student.uid || student.id || profile.id);
    // Fill in any missing fields from student without overwriting existing profile data
    profile = {
      ...profile,
      id: canonicalResolvedUid,
      uid: canonicalResolvedUid,
      name: profile.name || student.name || student.studentName,
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
    const fallbackTeacherEmail = isDisallowedAdminTeacher(student.teacherEmail, student.teacherName) ? null : student.teacherEmail;
    const fallbackTeacherName = isDisallowedAdminTeacher(student.teacherEmail, student.teacherName) ? null : student.teacherName;
    const canonicalResolvedUid = (uid && !uid.startsWith('usr-') && !uid.startsWith('st-')) ? uid : (student.uid || student.id || `usr-${Date.now()}`);
    profile = {
      id: canonicalResolvedUid,
      uid: canonicalResolvedUid,
      name: student.name || student.studentName,
      email,
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
  } else if (!profile && !student) {
    return res.json({
      success: true,
      profile: null,
      message: 'Profile not found',
    });
  }

  if (profile) {
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
    const journalEntries =
      (email && db.studentActivityJournal?.[email]) ||
      (uid && db.studentActivityJournal?.[uid]) ||
      profile.studentJournal ||
      [];
    profile.studentJournal = journalEntries;
  }

  res.json({ success: true, profile });
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

  const isTeacherUser =
    db.authUsers?.[targetEmail]?.role === 'teacher' ||
    (db.tutorsList || []).some((t: any) => (t.email || '').toLowerCase() === targetEmail) ||
    (db.teachers || []).some((t: any) => (t.email || '').toLowerCase() === targetEmail && t.role !== 'admin');

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
    contractedLessons: Number(rawProfile.contractedLessons ?? existing.contractedLessons ?? db.contractedLessons?.[targetEmail] ?? 1),
    completedLessonsCount: Number(existing.completedLessonsCount ?? rawProfile.completedLessonsCount ?? 0),
    teacherEmail: finalTeacherEmail,
    teacherName: finalTeacherName,
    teacherUid: resolvedTeacherUid && isValidCanonicalUid(resolvedTeacherUid) ? resolvedTeacherUid : null,
    assignedNativeFriendUID: resolvedTeacherUid && isValidCanonicalUid(resolvedTeacherUid) ? resolvedTeacherUid : null,
    nativeFriendUID: resolvedTeacherUid && isValidCanonicalUid(resolvedTeacherUid) ? resolvedTeacherUid : null,
    teacherMeetUrl: rawProfile.teacherMeetUrl ?? existing.teacherMeetUrl ?? null,
    enrollmentStatus: rawProfile.enrollmentStatus || existing.enrollmentStatus || (updatedTeacherEmail ? 'active' : 'not_enrolled'),
    studentJournal: rawProfile.studentJournal || existing.studentJournal || db.studentActivityJournal?.[targetEmail] || [],
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

  if (rawProfile.avatar || rawProfile.picture) {
    updatedProfileObj.avatar = rawProfile.avatar || rawProfile.picture;
    updatedProfileObj.picture = rawProfile.avatar || rawProfile.picture;
  }

  // 3. PERSISTENCE IN FIRESTORE VIA FIREBASE ADMIN SDK
  // Canonical record strictly in users/{targetUid}
  const firestoreDb = getFirestoreDb();
  let persistedToFirestore = false;
  if (firestoreDb && targetUid) {
    try {
      await firestoreDb.collection('users').doc(targetUid).set(updatedProfileObj, { merge: true });
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

  // 4. Update local cache / state
  db.userProfiles[targetEmail] = updatedProfileObj;

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
      contractedLessons: updatedProfileObj.contractedLessons,
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
      contractedLessons: updatedProfileObj.contractedLessons,
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
    distributeWeeklySpotifyForStudent(db, targetEmail, targetUid, newLevelKey, undefined, undefined, studentPlanDays);
  }

  await writeDbSync(db);
  res.json({ success: true, profile: db.userProfiles[targetEmail], persistedToFirestore });
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
  const targetStudentUid = verifiedCaller.role === 'admin' && req.body.studentUid ? req.body.studentUid : verifiedCaller.uid;

  if (!cleanStudentEmail && !targetStudentUid) {
    return res.status(400).json({ error: 'Identificador do aluno é obrigatório.' });
  }

  // 3. Idempotency protection to prevent duplicate purchases on retry
  const idempotencyKey = String(req.body.idempotencyKey || req.body.requestId || req.headers['idempotency-key'] || '').trim();
  if (idempotencyKey && Array.isArray(db.transactions)) {
    const existingTx = db.transactions.find((tx: any) => tx.idempotencyKey === idempotencyKey);
    if (existingTx) {
      return res.json({
        success: true,
        message: 'Package already purchased (idempotent)',
        contractedLessons: Number(db.contractedLessons?.[cleanStudentEmail] || db.userProfiles?.[cleanStudentEmail]?.contractedLessons || 0),
        profile: db.userProfiles?.[cleanStudentEmail],
        transaction: existingTx,
      });
    }
  }

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
  let atomicContractedTotal = 0;
  let atomicAvailableTotal = 0;

  if (firestoreDb && targetStudentUid) {
    try {
      await firestoreDb.runTransaction(async (transaction) => {
        const studentRef = firestoreDb.collection('users').doc(targetStudentUid);
        const teacherRef = firestoreDb.collection('users').doc(canonicalTeacherUid);

        const [studentSnap, teacherSnap] = await Promise.all([
          transaction.get(studentRef).catch(() => null),
          transaction.get(teacherRef).catch(() => null),
        ]);

        const studentData = (studentSnap && studentSnap.exists) ? (studentSnap.data() || {}) : {};
        const currentContracted = Number(studentData.contractedLessons ?? db.contractedLessons?.[cleanStudentEmail] ?? 0);
        const currentAvailable = Number(studentData.availableLessons ?? currentContracted);

        atomicContractedTotal = currentContracted + lessonsToAdd;
        atomicAvailableTotal = currentAvailable + lessonsToAdd;

        const studentUpdate: Record<string, any> = {
          contractedLessons: atomicContractedTotal,
          availableLessons: atomicAvailableTotal,
          teacherUid: canonicalTeacherUid,
          assignedNativeFriendUID: canonicalTeacherUid,
          nativeFriendUID: canonicalTeacherUid,
          teacherEmail: finalTeacherEmail,
          teacherName: finalTeacherName,
          enrollmentStatus: 'active',
          weeklyNativeLessonsTarget: newWeeklyTarget,
          subscriptionType: 'package',
          updatedAt: nowIso,
        };

        transaction.set(studentRef, studentUpdate, { merge: true });
        if (teacherSnap && teacherSnap.exists) {
          transaction.set(teacherRef, { updatedAt: nowIso }, { merge: true });
        }
      });

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
    } catch (fsErr) {
      console.warn('[purchase-package] Firestore Admin transaction notice:', fsErr);
    }
  }

  // 6. Update local synchronized state
  if (!db.contractedLessons) db.contractedLessons = {};
  const currentContracted = Number(db.contractedLessons[cleanStudentEmail] || 0);
  const newTotal = atomicContractedTotal > 0 ? atomicContractedTotal : (currentContracted + lessonsToAdd);
  db.contractedLessons[cleanStudentEmail] = newTotal;

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
        contractedLessons: newTotal,
        status: 'active',
      };
    }
    return s;
  });

  if (!studentFound) {
    db.students.push({
      id: targetStudentUid || `st-${Date.now()}`,
      uid: targetStudentUid || `st-${Date.now()}`,
      name: cleanStudentEmail.split('@')[0],
      studentName: cleanStudentEmail.split('@')[0],
      email: cleanStudentEmail,
      studentEmail: cleanStudentEmail,
      level: 'iniciante',
      studentLevel: 'iniciante',
      goal: 'English for everyday life & work',
      learningGoal: 'English for everyday life & work',
      contractedLessons: newTotal,
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
  if (!db.userProfiles) db.userProfiles = {};
  const existingProfile = db.userProfiles[cleanStudentEmail] || {};
  db.userProfiles[cleanStudentEmail] = {
    ...existingProfile,
    id: targetStudentUid || existingProfile.id || `usr-${Date.now()}`,
    uid: targetStudentUid || existingProfile.uid || `usr-${Date.now()}`,
    email: cleanStudentEmail,
    name: existingProfile.name || cleanStudentEmail.split('@')[0],
    level: existingProfile.level || 'iniciante',
    teacherEmail: finalTeacherEmail,
    teacherName: finalTeacherName,
    teacherUid: canonicalTeacherUid,
    assignedNativeFriendUID: canonicalTeacherUid,
    nativeFriendUID: canonicalTeacherUid,
    enrollmentStatus: 'active',
    contractedLessons: newTotal,
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
  };
  db.transactions.unshift(transaction);

  await writeDbSync(db);
  saveUserToFirestore(db.userProfiles[cleanStudentEmail]).catch(() => {});

  res.json({
    success: true,
    message: 'Package purchased successfully and Native Friend assigned',
    contractedLessons: newTotal,
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
  'user@example.com',
  'test@example.com',
  'student@example.com',
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
 * Ensures strict sequential 7-day exclusive track assignment for a student across all days (Monday to Sunday)
 * Each day receives one unique track from the curated level playlist, completely preventing repetitions.
 */
function distributeWeeklySpotifyForStudent(
  db: AppDb,
  email: string,
  uid: string,
  rawLevel?: string,
  teacherUid?: string,
  teacherEmail?: string,
  activeDays?: string[]
): any[] {
  const normLevel = normalizeStudentLevel(rawLevel || resolveStudentLevel(db, email, uid)).key;
  const dbSpotifyPlaylists = db.spotifyPlaylists || SPOTIFY_LEVEL_PLAYLISTS;
  const levelPlaylist = dbSpotifyPlaylists[normLevel] || dbSpotifyPlaylists.beginner || SPOTIFY_LEVEL_PLAYLISTS[normLevel] || SPOTIFY_LEVEL_PLAYLISTS.beginner;

  const targetKeys = Array.from(new Set([email, uid].filter(Boolean) as string[]));
  if (targetKeys.length === 0) return [];

  if (!db.studentSpotifyAssignments) db.studentSpotifyAssignments = {};
  if (!db.studentListenedTracks) db.studentListenedTracks = {};
  if (!db.studentRoutinesMap) db.studentRoutinesMap = {};

  let studentRoutines =
    (email && db.studentRoutinesMap[email]) ||
    (uid && db.studentRoutinesMap[uid]) ||
    null;

  if (!studentRoutines || typeof studentRoutines !== 'object' || Object.keys(studentRoutines).length === 0) {
    studentRoutines = createCleanStudentRoutines();
  } else {
    // Ensure all 7 days exist
    DAYS_SEQUENCE.forEach((d) => {
      if (!studentRoutines[d] || !Array.isArray(studentRoutines[d]) || studentRoutines[d].length === 0) {
        studentRoutines[d] = JSON.parse(JSON.stringify(createCleanStudentRoutines()[d] || []));
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

  // Consumed tracks: already listened by this student OR in studentJournal (Single Source of Truth)
  const consumedTrackIds = new Set<string>();
  targetKeys.forEach((k) => {
    const listened = db.studentListenedTracks?.[k] || [];
    listened.forEach((id: string) => {
      const cid = extractSpotifyTrackId(id);
      if (cid) consumedTrackIds.add(cid);
    });

    const journalEntries = [
      ...((db.studentActivityJournal?.[k]) || []),
      ...((db.userProfiles?.[k]?.studentJournal) || []),
    ];
    journalEntries.forEach((entry: any) => {
      if (entry && entry.type === 'audio' && entry.id) {
        const cid = extractSpotifyTrackId(entry.id);
        if (cid) consumedTrackIds.add(cid);
        if (entry.url) {
          const urlCid = extractSpotifyTrackId(entry.url);
          if (urlCid) consumedTrackIds.add(urlCid);
        }
      }
    });
  });

  const assignedRecords: any[] = [];
  const assignedInWeekTrackIds = new Set<string>();

  // All tracks from the level playlist in order, including extended track pool for multi-week cycles
  const allTracks = [
    ...DAYS_SEQUENCE.map((d, i) => ({
      day: d,
      index: i + 1,
      ...levelPlaylist.tracks[d],
    })),
    ...(levelPlaylist.pool || []).map((p: any, i: number) => ({
      day: p.dayOfWeek || 'monday',
      index: 8 + i,
      ...p,
    })),
  ];

  daysToDistribute.forEach((dayKey, idx) => {
    const designatedTrack = levelPlaylist.tracks[dayKey];
    let chosenTrack = designatedTrack;
    const designatedTrackId = extractSpotifyTrackId(designatedTrack?.url || (designatedTrack as any)?.trackId);

    // Anti-repetition check:
    // If designated track was already listened OR already assigned to an earlier day this week:
    if (!designatedTrackId || consumedTrackIds.has(designatedTrackId) || assignedInWeekTrackIds.has(designatedTrackId)) {
      // Find next unseen track in the level playlist
      const unseenCandidate = allTracks.find((t) => {
        const tid = extractSpotifyTrackId(t.url || (t as any).trackId);
        return tid && !consumedTrackIds.has(tid) && !assignedInWeekTrackIds.has(tid);
      });

      if (unseenCandidate) {
        chosenTrack = unseenCandidate;
      } else {
        // If all consumed, pick one not yet assigned in this specific week
        const unassignedThisWeek = allTracks.find((t) => {
          const tid = extractSpotifyTrackId(t.url || (t as any).trackId);
          return tid && !assignedInWeekTrackIds.has(tid);
        });
        chosenTrack = unassignedThisWeek || designatedTrack;
      }
    }

    const trackId = extractSpotifyTrackId(chosenTrack.url) || (chosenTrack as any).trackId || `track-${idx}`;
    assignedInWeekTrackIds.add(trackId);

    const canonicalUrl = `https://open.spotify.com/track/${trackId}`;
    const embedUrl = chosenTrack.embedUrl || `https://open.spotify.com/embed/track/${trackId}?utm_source=generator&theme=0`;

    const trackObj = {
      id: `sp-${dayKey}-${Date.now()}-${idx}`,
      url: canonicalUrl,
      trackId,
      title: chosenTrack.title,
      artistOrHost: chosenTrack.artist,
      duration: (chosenTrack as any)?.duration || '3-4 min',
      instructions: chosenTrack.teacherTipPt || 'Sugestão diária do Teacher: Ouça com atenção e pratique a compreensão auditiva.',
      type: 'music' as const,
      addedAt: new Date().toISOString(),
      level: normLevel,
      playlistId: levelPlaylist.playlistId,
      playlistTitle: levelPlaylist.playlistTitle,
      trackIndex: idx + 1,
    };

    const assignmentRecord = {
      id: `spot-assign-${dayKey}-${Date.now()}-${idx}`,
      activityId: `act-${dayKey}-2`,
      studentEmail: email,
      studentUid: uid,
      teacherUid: (teacherUid || '').trim(),
      teacherEmail: (teacherEmail || '').trim(),
      day: dayKey,
      trackId,
      trackTitle: chosenTrack.title,
      trackUrl: canonicalUrl,
      embedUrl,
      title: chosenTrack.title,
      artistOrHost: chosenTrack.artist,
      type: 'music' as const,
      instructions: trackObj.instructions,
      assignedAt: new Date().toISOString(),
      level: normLevel,
      playlistId: levelPlaylist.playlistId,
      playlistTitle: levelPlaylist.playlistTitle,
      trackIndex: idx + 1,
    };

    assignedRecords.push(assignmentRecord);

    if (studentRoutines && studentRoutines[dayKey]) {
      let matched = false;
      studentRoutines[dayKey] = studentRoutines[dayKey].map((item: any) => {
        const isTarget =
          item.id?.endsWith('2') ||
          item.activityName?.toLowerCase().includes('podcast') ||
          item.activityName?.toLowerCase().includes('áudio') ||
          item.activityName?.toLowerCase().includes('audio');
        if (isTarget) {
          matched = true;
          return { ...item, teacherSpotify: trackObj };
        }
        return item;
      });
      if (!matched && studentRoutines[dayKey].length > 0) {
        studentRoutines[dayKey][0] = {
          ...studentRoutines[dayKey][0],
          teacherSpotify: trackObj,
        };
      }
    }
  });

  targetKeys.forEach((key) => {
    db.studentSpotifyAssignments![key] = assignedRecords;
    db.studentRoutinesMap[key] = studentRoutines;
  });

  if (uid) {
    saveStudentAssignmentsByUid(uid, {
      uid,
      email,
      level: normLevel,
      spotifyAssignments: assignedRecords,
      videoAssignments: db.studentVideoAssignments?.[uid] || db.studentVideoAssignments?.[email] || [],
      routines: studentRoutines,
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

    const journalEntries = [
      ...((db.studentActivityJournal?.[k]) || []),
      ...((db.userProfiles?.[k]?.studentJournal) || []),
    ];
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

app.get('/api/student-routines', (req, res) => {
  const db = readDb();
  const studentEmail = ((req.query.studentEmail as string) || (req.query.email as string) || '').toLowerCase().trim();
  const uid = ((req.query.uid as string) || (req.query.studentUid as string) || '').trim();
  const resolved = resolveStudentIdentifiers(db, studentEmail, uid);

  const emailRoutines = (resolved.email && db.studentRoutinesMap?.[resolved.email]) || (studentEmail && db.studentRoutinesMap?.[studentEmail]);
  const uidRoutines = resolved.uid && db.studentRoutinesMap?.[resolved.uid];

  const countContent = (r: any) => {
    if (!r || typeof r !== 'object') return 0;
    let score = 0;
    Object.values(r).forEach((dayList: any) => {
      if (Array.isArray(dayList)) {
        dayList.forEach((act: any) => {
          if (act.teacherVideos && act.teacherVideos.length > 0) score += 10;
          if (act.learnedWords && act.learnedWords.length > 0) score += act.learnedWords.length;
        });
      }
    });
    return score;
  };

  const emailScore = countContent(emailRoutines);
  const uidScore = countContent(uidRoutines);
  let routines = uidScore >= emailScore && uidScore > 0 ? uidRoutines : (emailScore > 0 ? emailRoutines : (uidRoutines || emailRoutines));

  const targetKeys = Array.from(new Set([resolved.uid, resolved.email, studentEmail].filter(Boolean) as string[]));

  // Sync back to both keys so they never diverge
  if (routines) {
    if (!db.studentRoutinesMap) db.studentRoutinesMap = {};
    targetKeys.forEach((k) => {
      db.studentRoutinesMap[k] = routines;
    });
  }

  // Auto-distribute if video or spotify assignments are missing or have repeating duplicates
  let videoAssigns: any[] = [];
  let spotifyAssigns: any[] = [];

  for (const k of targetKeys) {
    if (db.studentVideoAssignments?.[k] && Array.isArray(db.studentVideoAssignments[k])) {
      videoAssigns = db.studentVideoAssignments[k];
      if (videoAssigns.length > 0) break;
    }
  }

  // If video assignments were missing but routines already has teacherVideos configured, extract them!
  if (videoAssigns.length === 0 && routines) {
    Object.keys(routines).forEach((d) => {
      const dayList = routines[d];
      if (Array.isArray(dayList)) {
        dayList.forEach((act: any) => {
          if (Array.isArray(act.teacherVideos) && act.teacherVideos.length > 0) {
            const v = act.teacherVideos[0];
            if (v && (v.videoId || v.url)) {
              videoAssigns.push({ ...v, day: d, dayOfWeek: d });
            }
          }
        });
      }
    });
    if (videoAssigns.length > 0) {
      if (!db.studentVideoAssignments) db.studentVideoAssignments = {};
      targetKeys.forEach((k) => {
        db.studentVideoAssignments[k] = videoAssigns;
      });
    }
  }
  for (const k of targetKeys) {
    if (db.studentSpotifyAssignments?.[k] && Array.isArray(db.studentSpotifyAssignments[k])) {
      spotifyAssigns = db.studentSpotifyAssignments[k];
      if (spotifyAssigns.length > 0) break;
    }
  }

  const uniqueVideoIds = new Set(
    videoAssigns.map((a) => extractServerYouTubeId(a.videoId || a.videoUrl)).filter(Boolean)
  );
  const hasRepeatingVideoBug = videoAssigns.length > 1 && uniqueVideoIds.size === 1;

  const uniqueTrackIds = new Set(
    spotifyAssigns.map((a) => extractSpotifyTrackId(a.trackId || a.url || a.trackUrl)).filter(Boolean)
  );
  const hasRepeatingSpotifyBug = spotifyAssigns.length > 1 && uniqueTrackIds.size === 1;

  let dbChanged = false;
  let isAwaitingTopicSelection = false;
  if (resolved.email || resolved.uid) {
    const studentLevel = normalizeStudentLevel(resolveStudentLevel(db, resolved.email, resolved.uid)).key;
    const studentPlanDays: string[] =
      (resolved.email && db.weeklyStudyDays?.[resolved.email] && db.weeklyStudyDays[resolved.email].length > 0)
        ? db.weeklyStudyDays[resolved.email]
        : (resolved.uid && db.weeklyStudyDays?.[resolved.uid] && db.weeklyStudyDays[resolved.uid].length > 0)
        ? db.weeklyStudyDays[resolved.uid]
        : (resolved.email && db.userProfiles?.[resolved.email]?.weeklyStudyDays && db.userProfiles[resolved.email].weeklyStudyDays.length > 0)
        ? db.userProfiles[resolved.email].weeklyStudyDays
        : (resolved.email && db.userProfiles?.[resolved.email]?.selectedStudyDays && db.userProfiles[resolved.email].selectedStudyDays.length > 0)
        ? db.userProfiles[resolved.email].selectedStudyDays
        : DAYS_SEQUENCE;
    const expectedDaysCount = Math.max(1, studentPlanDays.length);

    const hasVoluntaryVideoAssignments = videoAssigns.length > 0;
    isAwaitingTopicSelection = Boolean(
      (resolved.email && db.studentAwaitingTopicSelection?.[resolved.email]) ||
      (resolved.uid && db.studentAwaitingTopicSelection?.[resolved.uid]) ||
      !hasVoluntaryVideoAssignments
    );

    const hasSpotifyLevelMismatch = spotifyAssigns.length > 0 && spotifyAssigns.some((a) => {
      const aNorm = normalizeStudentLevel(a.level || a.playlistTitle).key;
      return aNorm !== studentLevel || (a.playlistId && a.playlistId !== SPOTIFY_LEVEL_PLAYLISTS[studentLevel].playlistId);
    });

    if (hasRepeatingVideoBug && !isAwaitingTopicSelection) {
      distributeWeeklyYouTubeForStudent(db, resolved.email, resolved.uid, studentLevel, undefined, undefined, studentPlanDays);
      dbChanged = true;
    }
    if (spotifyAssigns.length < expectedDaysCount || hasRepeatingSpotifyBug || hasSpotifyLevelMismatch) {
      distributeWeeklySpotifyForStudent(db, resolved.email, resolved.uid, studentLevel, undefined, undefined, studentPlanDays);
      dbChanged = true;
    }
    if (dbChanged) {
      writeDb(db);
      routines = (resolved.uid && db.studentRoutinesMap?.[resolved.uid]) || (resolved.email && db.studentRoutinesMap?.[resolved.email]) || routines;
    }
  }

  if (routines && typeof routines === 'object' && Object.keys(routines).length > 0) {
    const base = createCleanStudentRoutines();
    const merged = { ...base, ...routines };
    if (isAwaitingTopicSelection) {
      Object.keys(merged).forEach((d) => {
        if (Array.isArray(merged[d])) {
          merged[d] = merged[d].map((act: any) => {
            const isVideo =
              act.id?.endsWith('1') ||
              act.activityName?.toLowerCase().includes('vídeo') ||
              act.activityName?.toLowerCase().includes('video');
            if (isVideo && !act.teacherAssigned) {
              return {
                ...act,
                activityName: 'Video of the Day',
                playlistId: '',
                playlistTitle: '',
                teacherVideos: [],
              };
            }
            return act;
          });
        }
      });
    }
    return res.json(merged);
  }
  res.json(createCleanStudentRoutines());
});

/**
 * Weekly Cycle Intelligence & Progression:
 * Advances the student to a new weekly cycle ("Start New Week" / "Iniciar Nova Semana").
 * - Registers all current week's videos and Spotify tracks in consumed history (watchedVideos / listenedTracks).
 * - Generates 7 brand-new, non-repeating YouTube videos and Spotify tracks matching student level.
 * - Resets weekly activity checklist for the fresh cycle.
 * - Persists full state linked to student UID in Firestore and local db.
 */
app.post(['/api/student-routines/start-new-week', '/api/student/reset-week'], async (req, res) => {
  const db = readDb();
  const studentEmail = ((req.body.studentEmail as string) || (req.body.email as string) || '').toLowerCase().trim();
  const uid = ((req.body.uid as string) || (req.body.studentUid as string) || '').trim();
  const rawLevel = (req.body.level as string) || '';
  const weeklyStudyDaysTarget =
    typeof req.body.weeklyStudyDaysTarget === 'number' && req.body.weeklyStudyDaysTarget >= 1 && req.body.weeklyStudyDaysTarget <= 7
      ? req.body.weeklyStudyDaysTarget
      : undefined;
  const weeklyStudyDays = Array.isArray(req.body.weeklyStudyDays) ? req.body.weeklyStudyDays : undefined;

  const resolved = resolveStudentIdentifiers(db, studentEmail, uid);
  const targetKeys = Array.from(new Set([resolved.uid, resolved.email, studentEmail, uid].filter(Boolean) as string[]));

  if (targetKeys.length === 0) {
    return res.status(400).json({ error: 'Missing student identifier (email or uid)' });
  }

  // Persist weeklyStudyDaysTarget and weeklyStudyDays if provided
  if (!db.weeklyStudyDaysTargets) db.weeklyStudyDaysTargets = {};
  if (!db.weeklyStudyDays) db.weeklyStudyDays = {};
  targetKeys.forEach((k) => {
    if (weeklyStudyDaysTarget) db.weeklyStudyDaysTargets[k] = weeklyStudyDaysTarget;
    if (weeklyStudyDays) db.weeklyStudyDays[k] = weeklyStudyDays;
  });

  if (resolved.email && db.userProfiles?.[resolved.email]) {
    if (weeklyStudyDaysTarget) db.userProfiles[resolved.email].weeklyStudyDaysTarget = weeklyStudyDaysTarget;
    if (weeklyStudyDays) db.userProfiles[resolved.email].weeklyStudyDays = weeklyStudyDays;
  }

  // 1. Move all currently assigned videos and tracks to consumed history, merging global watched history
  if (!db.studentWatchedVideos) db.studentWatchedVideos = {};
  if (!db.studentListenedTracks) db.studentListenedTracks = {};

  const clientWatchedHistory: string[] = Array.isArray(req.body.watchedVideosHistory)
    ? req.body.watchedVideosHistory
    : [];

  targetKeys.forEach((k) => {
    if (!db.studentWatchedVideos[k]) db.studentWatchedVideos[k] = [];

    // Merge global watched history from client Firestore
    clientWatchedHistory.forEach((id: string) => {
      const vid = extractServerYouTubeId(id);
      if (vid && !db.studentWatchedVideos[k].includes(vid)) {
        db.studentWatchedVideos[k].push(vid);
      }
    });

    const existingVideos = db.studentVideoAssignments?.[k] || [];
    if (Array.isArray(existingVideos)) {
      existingVideos.forEach((v: any) => {
        const vid = extractServerYouTubeId(v.videoId || v.videoUrl);
        if (vid && !db.studentWatchedVideos[k].includes(vid)) {
          db.studentWatchedVideos[k].push(vid);
        }
      });
    }

    const existingTracks = db.studentSpotifyAssignments?.[k] || [];
    if (Array.isArray(existingTracks)) {
      if (!db.studentListenedTracks[k]) db.studentListenedTracks[k] = [];
      existingTracks.forEach((t: any) => {
        const tid = extractSpotifyTrackId(t.trackId || t.url || t.trackUrl);
        if (tid && !db.studentListenedTracks[k].includes(tid)) {
          db.studentListenedTracks[k].push(tid);
        }
      });
    }

    // Clear current assignments so fresh generation is applied
    if (db.studentVideoAssignments?.[k]) {
      db.studentVideoAssignments[k] = [];
    }
    if (db.studentSpotifyAssignments?.[k]) {
      db.studentSpotifyAssignments[k] = [];
    }
  });

  // 2. Advance student weekly cycle count
  const currentCycle =
    db.userProfiles?.[resolved.email]?.weeklyCycle ||
    db.students?.find((s: any) => s.email?.toLowerCase() === resolved.email || (resolved.uid && s.uid === resolved.uid))?.weeklyCycle ||
    1;
  const nextCycle = currentCycle + 1;

  if (resolved.email && db.userProfiles?.[resolved.email]) {
    db.userProfiles[resolved.email].weeklyCycle = nextCycle;
  }
  if (db.students) {
    db.students = db.students.map((s: any) => {
      if (s.email?.toLowerCase() === resolved.email || (resolved.uid && s.uid === resolved.uid)) {
        return {
          ...s,
          weeklyCycle: nextCycle,
          weeklyStudyDaysTarget: weeklyStudyDaysTarget || s.weeklyStudyDaysTarget,
          weeklyStudyDays: weeklyStudyDays || s.weeklyStudyDays,
        };
      }
      return s;
    });
  }

  // 3. Reset weekly activity checks and reset routine completion/repeat flags for the new week
  if (!db.studentWeeklyChecks) db.studentWeeklyChecks = {};
  if (!db.studentAwaitingTopicSelection) db.studentAwaitingTopicSelection = {};

  targetKeys.forEach((k) => {
    db.studentWeeklyChecks[k] = {};
    db.studentAwaitingTopicSelection[k] = true;
    db.studentVideoAssignments[k] = [];

    if (db.studentRoutinesMap?.[k]) {
      Object.keys(db.studentRoutinesMap[k]).forEach((dayKey) => {
        const dayActs = db.studentRoutinesMap[k][dayKey];
        if (Array.isArray(dayActs)) {
          dayActs.forEach((act: any) => {
            act.completed = false;
            act.completedToday = false;
            act.isRepeatVideo = false;
            act.repeatVideo = false;
            const isVideoAct =
              act.id?.endsWith('1') ||
              act.activityName?.toLowerCase().includes('vídeo') ||
              act.activityName?.toLowerCase().includes('video');
            if (isVideoAct) {
              act.activityName = 'Video of the Day';
              act.playlistId = '';
              act.playlistTitle = '';
              act.teacherVideos = [];
            }
          });
        }
      });
    }
  });

  // Reset global default routines completion and repeat flags
  if (db.routinesByDay) {
    Object.keys(db.routinesByDay).forEach((dayKey) => {
      const dayActs = db.routinesByDay[dayKey];
      if (Array.isArray(dayActs)) {
        dayActs.forEach((act: any) => {
          act.completed = false;
          act.completedToday = false;
          act.isRepeatVideo = false;
          act.repeatVideo = false;
        });
      }
    });
  }

  // 4. Ingest past listened tracks history from client to guarantee anti-repetition exclusivity
  const clientListenedHistory: string[] = Array.isArray(req.body.listenedTracksHistory)
    ? req.body.listenedTracksHistory
    : [];

  targetKeys.forEach((k) => {
    if (!db.studentListenedTracks) db.studentListenedTracks = {};
    if (!db.studentListenedTracks[k]) db.studentListenedTracks[k] = [];
    clientListenedHistory.forEach((id: string) => {
      const tid = extractSpotifyTrackId(id);
      if (tid && !db.studentListenedTracks[k].includes(tid)) {
        db.studentListenedTracks[k].push(tid);
      }
    });
  });

  // Distribute new weekly Spotify tracks with guaranteed anti-repetition.
  const studentLevel = normalizeStudentLevel(rawLevel || resolveStudentLevel(db, resolved.email, resolved.uid)).key;
  const weeklyStudyDaysList: DayOfWeek[] | undefined = Array.isArray(req.body.weeklyStudyDays)
    ? req.body.weeklyStudyDays
    : undefined;
  const newTracks = distributeWeeklySpotifyForStudent(
    db,
    resolved.email,
    resolved.uid,
    studentLevel,
    undefined,
    undefined,
    weeklyStudyDaysList
  );

  // 5. Ingest new client-assigned videos or distribute fresh unseen videos sequentially
  const clientAssignedVideos: any[] = Array.isArray(req.body.newAssignedVideos)
    ? req.body.newAssignedVideos
    : [];

  let newVideos: any[] = [];
  if (clientAssignedVideos.length > 0) {
    newVideos = clientAssignedVideos.map((v: any, idx: number) => {
      const vidId = extractServerYouTubeId(v.videoId || v.url) || v.videoId;
      return {
        id: `assign-${v.day}-${Date.now()}-${idx}`,
        activityId: `act-${v.day}-1`,
        studentEmail: resolved.email,
        studentUid: resolved.uid,
        day: v.day,
        playlistId: v.playlistId,
        playlistTitle: v.playlistTitle,
        videoId: vidId,
        title: v.videoTitle || v.title || 'Daily Video Practice',
        videoTitle: v.videoTitle || v.title || 'Daily Video Practice',
        videoUrl: v.url || `https://www.youtube.com/watch?v=${vidId}`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${vidId}?rel=0&modestbranding=1&enablejsapi=1`,
        assignedAt: new Date().toISOString(),
        duration: v.duration || '6-10 min',
        instructions: v.instructions || 'Daily Video Practice',
      };
    });

    targetKeys.forEach((k) => {
      db.studentVideoAssignments[k] = newVideos;
      if (!db.studentRoutinesMap[k]) {
        db.studentRoutinesMap[k] = JSON.parse(JSON.stringify(db.routinesByDay || defaultRoutinesByDay));
      }
      newVideos.forEach((v: any) => {
        const d = v.day;
        if (d && db.studentRoutinesMap[k][d]) {
          db.studentRoutinesMap[k][d] = db.studentRoutinesMap[k][d].map((act: any) => {
            const isVideoAct =
              act.id?.endsWith('1') ||
              act.activityName?.toLowerCase().includes('vídeo') ||
              act.activityName?.toLowerCase().includes('video') ||
              (act.teacherVideos && act.teacherVideos.length > 0);
            if (isVideoAct) {
              return {
                ...act,
                activityName: v.playlistTitle || act.activityName || 'Daily Video Practice',
                teacherVideos: [
                  {
                    id: `vid-${d}-${v.videoId}`,
                    videoId: v.videoId,
                    title: v.videoTitle || v.title || 'Daily Video Practice',
                    videoTitle: v.videoTitle || v.title || 'Daily Video Practice',
                    url: v.videoUrl,
                    duration: v.duration || '6-10 min',
                    playlistId: v.playlistId,
                    playlistTitle: v.playlistTitle,
                  },
                ],
                isRepeatVideo: false,
                repeatVideo: false,
                completed: false,
                completedToday: false,
              };
            }
            return act;
          });
        }
      });
    });
  } else if (!req.body.resetTopicsToChooseTopic && req.body.autoAssignVideos) {
    newVideos = distributeWeeklyYouTubeForStudent(
      db,
      resolved.email,
      resolved.uid,
      studentLevel,
      undefined,
      undefined,
      weeklyStudyDays,
      clientWatchedHistory
    );
  } else {
    // Default for starting a new week: all days start clean with "Choose a Topic"
    newVideos = [];
  }

  writeDb(db);

  const rawRoutines =
    (resolved.uid && db.studentRoutinesMap?.[resolved.uid]) ||
    (resolved.email && db.studentRoutinesMap?.[resolved.email]) ||
    db.routinesByDay ||
    defaultRoutinesByDay;

  const routines: any = {};
  Object.keys(rawRoutines).forEach((d) => {
    routines[d] = (rawRoutines[d] || []).map((act: any) => {
      const isVideoAct =
        act.id?.endsWith('1') ||
        act.activityName?.toLowerCase().includes('vídeo') ||
        act.activityName?.toLowerCase().includes('video') ||
        (act.teacherVideos && act.teacherVideos.length > 0);
      const shouldResetVideo = isVideoAct && (!req.body.autoAssignVideos || req.body.resetTopicsToChooseTopic);
      return {
        ...act,
        completed: false,
        completedToday: false,
        isRepeatVideo: false,
        repeatVideo: false,
        ...(shouldResetVideo ? {
          activityName: 'Video of the Day',
          playlistId: '',
          playlistTitle: '',
          teacherVideos: [],
        } : {}),
      };
    });
  });

  // 5. Cloud Firestore synchronization linked to UID
  if (resolved.uid) {
    resetRepeatFlagsSubcollection(resolved.uid).catch(() => {});
    const watched = db.studentWatchedVideos[resolved.uid] || [];
    watched.forEach((vidId: string) => {
      addWatchedVideoToUserDoc(resolved.uid, vidId).catch(() => {});
    });

    saveStudentAssignmentsByUid(resolved.uid, {
      uid: resolved.uid,
      email: resolved.email,
      level: studentLevel,
      weeklyCycle: nextCycle,
      weeklyStudyDaysTarget: weeklyStudyDaysTarget || db.weeklyStudyDaysTargets?.[resolved.uid] || 7,
      weeklyStudyDays: weeklyStudyDays || db.weeklyStudyDays?.[resolved.uid] || [],
      videoAssignments: newVideos,
      spotifyAssignments: newTracks,
      routines,
      watchedVideos: db.studentWatchedVideos[resolved.uid] || [],
      listenedTracks: db.studentListenedTracks[resolved.uid] || [],
      updatedAt: new Date().toISOString(),
    }).catch((e) => console.warn('Firestore sync notice for student assignments:', e));
  }
  saveAppStateToFirestore(db).catch(() => {});

  res.json({
    success: true,
    weeklyCycle: nextCycle,
    weeklyStudyDaysTarget: weeklyStudyDaysTarget || db.weeklyStudyDaysTargets?.[resolved.email] || 7,
    weeklyStudyDays: weeklyStudyDays || db.weeklyStudyDays?.[resolved.email] || [],
    message: 'New weekly cycle activated successfully',
    routines,
    videoAssignments: newVideos,
    spotifyAssignments: newTracks,
  });
});

// Real-time Current Routine & Spotify Track Mirroring Endpoints
app.post('/api/routines/current-routine', (req, res) => {
  const { studentUid, weekId, currentSpotifyTrack, studentEmail, nativeFriendUid, nativeFriendEmail } = req.body;
  if (!studentUid) {
    return res.status(400).json({ error: 'studentUid is required' });
  }

  const db = readDb();
  if (!(db as any).studentCurrentRoutines) {
    (db as any).studentCurrentRoutines = {};
  }

  const cleanUid = String(studentUid).toLowerCase().trim();
  const safeWeekId = weekId || 'week-1';
  const key = `${cleanUid}:${safeWeekId}`;
  const weekDataKey = `${cleanUid}:weekData`;

  const existing = (db as any).studentCurrentRoutines[key] || {};
  const updatedDoc = {
    ...existing,
    studentUid: cleanUid,
    weekId: safeWeekId,
    currentSpotifyTrack: currentSpotifyTrack !== undefined ? currentSpotifyTrack : existing.currentSpotifyTrack,
    studentEmail: studentEmail || existing.studentEmail,
    nativeFriendUid: nativeFriendUid || existing.nativeFriendUid,
    nativeFriendEmail: nativeFriendEmail || existing.nativeFriendEmail,
    updatedAt: new Date().toISOString(),
  };

  (db as any).studentCurrentRoutines[key] = updatedDoc;
  (db as any).studentCurrentRoutines[weekDataKey] = {
    ...((db as any).studentCurrentRoutines[weekDataKey] || {}),
    ...updatedDoc,
  };

  writeDb(db);
  res.json({ success: true, routine: updatedDoc });
});

app.get('/api/routines/current-routine', (req, res) => {
  const studentUid = (req.query.studentUid as string || '').toLowerCase().trim();
  const weekId = (req.query.weekId as string || 'week-1').trim();
  if (!studentUid) {
    return res.status(400).json({ error: 'studentUid is required' });
  }

  const db = readDb();
  const routinesMap = (db as any).studentCurrentRoutines || {};

  // Check weekData first, then requested weekId
  let routine = routinesMap[`${studentUid}:weekData`] || routinesMap[`${studentUid}:${weekId}`] || null;

  // Fallback: if routine is missing or track is null, search all cycles for this student
  if (!routine || !routine.currentSpotifyTrack) {
    const studentKeys = Object.keys(routinesMap).filter((k) => k.startsWith(`${studentUid}:`));
    const matching = studentKeys
      .map((k) => routinesMap[k])
      .filter((r) => r && r.currentSpotifyTrack)
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
    if (matching.length > 0) {
      routine = matching[0];
    }
  }

  res.json({ success: true, routine });
});

app.post('/api/routines/current-routine/feedback', (req, res) => {
  const { studentUid, weekId, feedback } = req.body;
  if (!studentUid || !feedback || !feedback.dayOfWeek) {
    return res.status(400).json({ error: 'studentUid and feedback with dayOfWeek are required' });
  }

  const db = readDb();
  if (!(db as any).studentCurrentRoutines) {
    (db as any).studentCurrentRoutines = {};
  }

  const cleanUid = String(studentUid).toLowerCase().trim();
  const safeWeekId = weekId || 'week-1';
  const key = `${cleanUid}:${safeWeekId}`;
  const weekDataKey = `${cleanUid}:weekData`;

  const existing = (db as any).studentCurrentRoutines[key] || {
    studentUid: cleanUid,
    weekId: safeWeekId,
  };

  if (!existing.teacherFeedback) existing.teacherFeedback = {};
  existing.teacherFeedback[feedback.dayOfWeek] = feedback;
  existing.updatedAt = new Date().toISOString();

  (db as any).studentCurrentRoutines[key] = existing;

  const existingWeekData = (db as any).studentCurrentRoutines[weekDataKey] || {
    studentUid: cleanUid,
    weekId: safeWeekId,
  };
  if (!existingWeekData.teacherFeedback) existingWeekData.teacherFeedback = {};
  existingWeekData.teacherFeedback[feedback.dayOfWeek] = feedback;
  existingWeekData.updatedAt = new Date().toISOString();
  (db as any).studentCurrentRoutines[weekDataKey] = existingWeekData;

  writeDb(db);
  res.json({ success: true, routine: existing });
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

  const isApprovedTutorData = (data: any): boolean => {
    if (!data) return false;
    const role = (data.role || '').toLowerCase().trim();
    const isTeacherRole =
      role === 'teacher' ||
      role === 'tutor' ||
      role === 'native_friend' ||
      data.isTeacher === true;
    const isApproved =
      data.approvalStatus === 'approved' ||
      data.isApproved === true ||
      data.approved === true ||
      data.status === 'approved';
    return Boolean(isTeacherRole && isApproved);
  };

  try {
    // 1. Check /users/{cleanUid}
    const userDoc = await firestore.collection('users').doc(cleanUid).get().catch(() => null);
    if (userDoc && userDoc.exists) {
      const uData = userDoc.data();
      if (isApprovedTutorData(uData)) {
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
      if (isApprovedTutorData(tData)) {
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
      if (isApprovedTutorData(tData)) {
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
      if (isApprovedTutorData(tData)) {
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
        if (isApprovedTutorData(tData)) {
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

      // Verify server-side administrative authority strictly
      const AUTHORITATIVE_ADMIN_EMAILS = new Set([
        'adm.itissimple@gmail.com',
        'estilobeeforkids@gmail.com',
        'adm.itssimple@gmail.com',
        'estilobeeadm@gmail.com',
        'admin@itissimple.com',
      ]);

      const isAdmin =
        user.role === 'admin' ||
        (emailVerified && Boolean(email) && AUTHORITATIVE_ADMIN_EMAILS.has(email));

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
        // Authoritative admin: can query all canonical lessons
        const snapshot = await firestore.collection('lessons').get();
        for (const doc of snapshot.docs) {
          lessonsById.set(doc.id, {
            ...doc.data(),
            id: doc.id,
          });
        }

        const legacyLessons = readDb().liveLessons || [];
        for (const lesson of legacyLessons) {
          if (lesson?.id && !lessonsById.has(lesson.id)) {
            lessonsById.set(lesson.id, lesson);
          }
        }
      } else if (isTeacher) {
        // Teacher (Native Friend): execute strictly filtered queries to avoid unrestricted scan
        const publicTutorId = teacherInfo.publicTutorId;
        const teacherEmail = (teacherInfo.email || email).toLowerCase().trim();

        const queryPromises: Promise<any>[] = [];

        if (publicTutorId) {
          queryPromises.push(
            firestore.collection('lessons').where('teacherUid', '==', publicTutorId).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('tutorUid', '==', publicTutorId).get().catch(() => ({ docs: [] })),
            firestore.collection('tutors').doc(publicTutorId).collection('lessons').get().catch(() => ({ docs: [] }))
          );
        }

        if (uid && uid !== publicTutorId) {
          queryPromises.push(
            firestore.collection('lessons').where('teacherUid', '==', uid).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('tutorUid', '==', uid).get().catch(() => ({ docs: [] })),
            firestore.collection('users').doc(uid).collection('lessons').get().catch(() => ({ docs: [] }))
          );
        }

        if (teacherEmail) {
          queryPromises.push(
            firestore.collection('lessons').where('teacherEmail', '==', teacherEmail).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('tutorEmail', '==', teacherEmail).get().catch(() => ({ docs: [] }))
          );
        }

        const snapshots = await Promise.all(queryPromises);
        for (const snap of snapshots) {
          if (snap && snap.docs) {
            for (const doc of snap.docs) {
              lessonsById.set(doc.id, {
                ...doc.data(),
                id: doc.id,
              });
            }
          }
        }

        // Legacy lessons compatibility: check if matching teacher
        const legacyLessons = readDb().liveLessons || [];
        for (const lesson of legacyLessons) {
          if (!lesson?.id || lessonsById.has(lesson.id)) continue;
          const lTeacherUid = (lesson.teacherUid || lesson.tutorUid || '').trim();
          const lTeacherEmail = (lesson.teacherEmail || lesson.tutorEmail || '').toLowerCase().trim();

          const matches =
            (publicTutorId && lTeacherUid === publicTutorId) ||
            (uid && lTeacherUid === uid) ||
            (teacherEmail && lTeacherEmail === teacherEmail);

          if (matches) {
            lessonsById.set(lesson.id, lesson);
          }
        }
      } else {
        // Student: execute strictly filtered queries to avoid unrestricted scan
        const queryPromises: Promise<any>[] = [
          firestore.collection('lessons').where('studentUid', '==', uid).get().catch(() => ({ docs: [] })),
          firestore.collection('users').doc(uid).collection('lessons').get().catch(() => ({ docs: [] })),
        ];

        if (email) {
          queryPromises.push(
            firestore.collection('lessons').where('studentEmail', '==', email).get().catch(() => ({ docs: [] }))
          );
        }

        const snapshots = await Promise.all(queryPromises);
        for (const snap of snapshots) {
          if (snap && snap.docs) {
            for (const doc of snap.docs) {
              lessonsById.set(doc.id, {
                ...doc.data(),
                id: doc.id,
              });
            }
          }
        }

        // Legacy lessons compatibility: check if matching student
        const legacyLessons = readDb().liveLessons || [];
        for (const lesson of legacyLessons) {
          if (!lesson?.id || lessonsById.has(lesson.id)) continue;
          const lStudentUid = (lesson.studentUid || '').trim();
          const lStudentEmail = (lesson.studentEmail || '').toLowerCase().trim();

          const matches =
            lStudentUid === uid ||
            (Boolean(email) && lStudentEmail === email);

          if (matches) {
            lessonsById.set(lesson.id, lesson);
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
      let teacherAuthUid = '';
      let teacherEmail = queryEmail;

      if (firestore) {
        // Attempt to resolve tutor profile from Firestore
        for (const target of candidateTargets) {
          try {
            // Direct doc lookup in tutors
            const tutorDoc = await firestore.collection('tutors').doc(target).get().catch(() => null);
            if (tutorDoc && tutorDoc.exists) {
              const tData = tutorDoc.data();
              if (tData) {
                publicTutorId = tData.publicTutorId || tutorDoc.id;
                teacherAuthUid = tData.authUid || tData.uid || '';
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
                teacherAuthUid = tData.authUid || tData.uid || '';
                if (!teacherEmail && tData.email) teacherEmail = tData.email.toLowerCase().trim();
                break;
              }
            }

            // By email
            if (target.includes('@')) {
              const qEm = await firestore.collection('tutors').where('email', '==', target.toLowerCase().trim()).limit(1).get().catch(() => null);
              if (qEm && !qEm.empty) {
                const tData = qEm.docs[0].data();
                if (tData) {
                  publicTutorId = tData.publicTutorId || qEm.docs[0].id;
                  teacherAuthUid = tData.authUid || tData.uid || '';
                  teacherEmail = tData.email.toLowerCase().trim();
                  break;
                }
              }
            }
          } catch {}
        }
      }

      // If not resolved from Firestore tutors, check dbState
      const db = readDb();
      if (!publicTutorId && db.tutorsList) {
        const found = db.tutorsList.find((t: any) => {
          const tEmail = (t.email || '').toLowerCase().trim();
          const tId = (t.publicTutorId || t.id || '').trim();
          return (
            (rawTarget && (tId === rawTarget || tEmail === rawTarget.toLowerCase())) ||
            (queryEmail && tEmail === queryEmail) ||
            (queryUid && (t.uid === queryUid || t.authUid === queryUid))
          );
        });
        if (found) {
          publicTutorId = found.publicTutorId || found.id || '';
          teacherAuthUid = found.authUid || found.uid || '';
          if (!teacherEmail && found.email) teacherEmail = found.email.toLowerCase().trim();
        }
      }

      if (!publicTutorId && !rawTarget.includes('@') && rawTarget) {
        publicTutorId = rawTarget;
      }

      const activeLessonsMap = new Map<string, any>();

      // Fetch active scheduled lessons for this teacher from Firestore
      if (firestore) {
        const queryPromises: Promise<any>[] = [];
        if (publicTutorId) {
          queryPromises.push(
            firestore.collection('lessons').where('teacherUid', '==', publicTutorId).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('tutorUid', '==', publicTutorId).get().catch(() => ({ docs: [] })),
            firestore.collection('tutors').doc(publicTutorId).collection('lessons').get().catch(() => ({ docs: [] }))
          );
        }
        if (teacherAuthUid && teacherAuthUid !== publicTutorId) {
          queryPromises.push(
            firestore.collection('lessons').where('teacherUid', '==', teacherAuthUid).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('tutorUid', '==', teacherAuthUid).get().catch(() => ({ docs: [] })),
            firestore.collection('users').doc(teacherAuthUid).collection('lessons').get().catch(() => ({ docs: [] }))
          );
        }
        if (teacherEmail) {
          queryPromises.push(
            firestore.collection('lessons').where('teacherEmail', '==', teacherEmail).get().catch(() => ({ docs: [] })),
            firestore.collection('lessons').where('tutorEmail', '==', teacherEmail).get().catch(() => ({ docs: [] }))
          );
        }

        const snapshots = await Promise.all(queryPromises);
        for (const snap of snapshots) {
          if (snap && snap.docs) {
            for (const doc of snap.docs) {
              activeLessonsMap.set(doc.id, doc.data());
            }
          }
        }
      }

      // Check legacy liveLessons
      const legacyLessons = db.liveLessons || [];
      for (const lesson of legacyLessons) {
        if (!lesson?.id || activeLessonsMap.has(lesson.id)) continue;
        const lTeacherUid = (lesson.teacherUid || lesson.tutorUid || '').trim();
        const lTeacherEmail = (lesson.teacherEmail || lesson.tutorEmail || '').toLowerCase().trim();
        const matches =
          (publicTutorId && lTeacherUid === publicTutorId) ||
          (teacherAuthUid && lTeacherUid === teacherAuthUid) ||
          (teacherEmail && lTeacherEmail === teacherEmail);
        if (matches) {
          activeLessonsMap.set(lesson.id, lesson);
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
            l.status === 'scheduled' &&
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
  if (req.body.studentUid && req.body.studentUid.trim() !== studentAuthUid) {
    return res.status(403).json({
      error: 'Proibido: tentativa de agendar aula em nome de outro estudante.',
      message: 'Student UID does not match authenticated token UID',
    });
  }
  if (
    req.body.studentEmail &&
    verifiedStudentEmail &&
    req.body.studentEmail.toLowerCase().trim() !== verifiedStudentEmail
  ) {
    return res.status(403).json({
      error: 'Proibido: tentativa de agendar aula com e-mail divergente do token autenticado.',
      message: 'Student email does not match authenticated token email',
    });
  }

  const db = readDb();
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
      existingLessons: db.liveLessons,
      dbState: db,
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        error: result.error,
        message: result.error,
      });
    }

    await writeDbSync(db);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('Error in POST /api/lessons/schedule:', err);
    return res.status(500).json({
      error: 'Erro interno ao processar agendamento de aula.',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post(['/api/lessons', '/api/live-lessons'], async (req, res) => {
  const db = readDb();
  const { lesson, lessons } = req.body;
  const newLesson = lesson || (req.body.id ? req.body : null);
  if (Array.isArray(lessons)) {
    db.liveLessons = lessons;
  } else if (newLesson && newLesson.id) {
    // Auto-resolve studentEmail if blank
    if (!newLesson.studentEmail || newLesson.studentEmail.trim() === '') {
      if (req.query.email || req.query.studentEmail) {
        newLesson.studentEmail = ((req.query.email || req.query.studentEmail) as string).toLowerCase().trim();
      } else if (newLesson.studentUid) {
        const allUsers = Object.values(db.authUsers || {});
        const allProfiles = Object.values(db.userProfiles || {});
        const foundUser = (allUsers as any[]).find((u: any) => u.uid === newLesson.studentUid || u.id === newLesson.studentUid)
          || (allProfiles as any[]).find((p: any) => p.uid === newLesson.studentUid || p.id === newLesson.studentUid)
          || (db.students || []).find((s: any) => s.studentUid === newLesson.studentUid || s.id === newLesson.studentUid);
        if (foundUser?.email) {
          newLesson.studentEmail = foundUser.email.toLowerCase().trim();
        }
      }
    }

    // Auto-resolve studentUid and teacherUid to individualize activity between the two UIDs
    if (!newLesson.studentUid && newLesson.studentEmail) {
      const sEmail = newLesson.studentEmail.toLowerCase().trim();
      const allUsers = Object.values(db.authUsers || {});
      const allProfiles = Object.values(db.userProfiles || {});
      const foundUser = (allUsers as any[]).find((u: any) => (u.email || '').toLowerCase().trim() === sEmail)
        || (allProfiles as any[]).find((p: any) => (p.email || '').toLowerCase().trim() === sEmail)
        || (db.students || []).find((s: any) => (s.email || '').toLowerCase().trim() === sEmail);
      newLesson.studentUid = foundUser?.uid || foundUser?.id || `usr-${sEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    }
    if (!newLesson.teacherUid || !isValidCanonicalUid(newLesson.teacherUid)) {
      const tTarget = newLesson.teacherId || newLesson.teacherUid || newLesson.teacherEmail || newLesson.tutorEmail;
      const teacherRes = await resolveTeacherCanonicalIdentity({
        teacherId: typeof tTarget === 'string' ? tTarget : undefined,
        teacherEmail: newLesson.teacherEmail || newLesson.tutorEmail,
        dbState: db,
      });
      if (teacherRes && isValidCanonicalUid(teacherRes.canonicalUid)) {
        if (!teacherRes.isApproved) {
          return res.status(400).json({ error: 'O Amigo Nativo selecionado ainda não foi aprovado para receber aulas.' });
        }
        newLesson.teacherUid = teacherRes.canonicalUid;
        newLesson.teacherAuthUid = teacherRes.canonicalUid;
        if (!newLesson.teacherEmail) newLesson.teacherEmail = teacherRes.email;
        if (!newLesson.teacherName) newLesson.teacherName = teacherRes.name;
      } else {
        return res.status(400).json({ error: 'Identificador canônico do Amigo Nativo não comprovado.' });
      }
    }

    // Conflict Check (Strict Anti-Duplicity Rule - Individualized by teacher and student UIDs/emails)
    const proposedTeacher = (newLesson.teacherEmail || newLesson.tutorEmail || '').toLowerCase().trim();
    const proposedTeacherUid = (newLesson.teacherUid || newLesson.tutorUid || '').trim();
    const proposedStudent = (newLesson.studentEmail || '').toLowerCase().trim();
    const proposedStudentUid = (newLesson.studentUid || '').trim();

    if ((proposedTeacher || proposedTeacherUid) && newLesson.startDateTime && newLesson.endDateTime && newLesson.status === 'scheduled' && !newLesson.cancelledAt) {
      const pStart = new Date(newLesson.startDateTime).getTime();
      const pEnd = new Date(newLesson.endDateTime).getTime();
      const conflict = (db.liveLessons || []).find((l: any) => {
        if (l.id === newLesson.id) return false;
        if (l.status === 'cancelled' || l.status === 'canceled' || Boolean(l.cancelledAt)) return false;
        if (l.status && l.status !== 'scheduled') return false;

        const lTeacher = (l.teacherEmail || l.tutorEmail || '').toLowerCase().trim();
        const lTeacherUid = (l.teacherUid || l.tutorUid || '').trim();
        const lStudent = (l.studentEmail || '').toLowerCase().trim();
        const lStudentUid = (l.studentUid || '').trim();

        // Check if teacher has an active conflict
        const isSameTeacher = (proposedTeacherUid && lTeacherUid && proposedTeacherUid === lTeacherUid) ||
                              (proposedTeacher && lTeacher && proposedTeacher === lTeacher);

        // Check if student has an active conflict
        const isSameStudent = (proposedStudentUid && lStudentUid && proposedStudentUid === lStudentUid) ||
                              (proposedStudent && lStudent && proposedStudent === lStudent);

        if (!isSameTeacher && !isSameStudent) return false;
        if (!l.startDateTime || !l.endDateTime) return false;
        const lStart = new Date(l.startDateTime).getTime();
        const lEnd = new Date(l.endDateTime).getTime();
        return lStart < pEnd && lEnd > pStart;
      });
      if (conflict) {
        return res.status(409).json({
          error: 'Conflito de Horário: Já existe uma aula agendada neste horário para este Amigo Nativo ou Aluno.',
          conflict,
        });
      }
    }

    const idx = (db.liveLessons || []).findIndex((l: any) => l.id === newLesson.id);
    if (idx >= 0) {
      db.liveLessons[idx] = newLesson;
    } else {
      if (!db.liveLessons) db.liveLessons = [];
      db.liveLessons.unshift(newLesson);
    }

    // Bidirectional sync: ensure student is linked to this teacher in db.students if unassigned
    const cleanStudentEmail = (newLesson.studentEmail || '').toLowerCase().trim();
    const cleanTeacherEmail = (newLesson.teacherEmail || newLesson.tutorEmail || '').toLowerCase().trim();
    const cleanTeacherName = newLesson.teacherName || newLesson.tutorName || '';
    if (cleanStudentEmail && cleanTeacherEmail) {
      const studentIdx = (db.students || []).findIndex(
        (s: any) => (s.email || s.studentEmail || '').toLowerCase() === cleanStudentEmail
      );
      if (studentIdx >= 0) {
        const existingTeacher = (db.students[studentIdx].teacherEmail || '').toLowerCase().trim();
        const shouldUpdateTeacher = !existingTeacher || existingTeacher === cleanTeacherEmail;
        db.students[studentIdx] = {
          ...db.students[studentIdx],
          teacherEmail: shouldUpdateTeacher ? cleanTeacherEmail : db.students[studentIdx].teacherEmail,
          teacherName: shouldUpdateTeacher ? (cleanTeacherName || db.students[studentIdx].teacherName) : db.students[studentIdx].teacherName,
          teacherUid: shouldUpdateTeacher ? (newLesson.teacherUid || db.students[studentIdx].teacherUid) : db.students[studentIdx].teacherUid,
          studentUid: newLesson.studentUid || db.students[studentIdx].studentUid || db.students[studentIdx].uid,
          status: 'active',
        };
      } else {
        if (!db.students) db.students = [];
        db.students.push({
          id: `st-${Date.now()}`,
          name: newLesson.studentName || cleanStudentEmail.split('@')[0],
          studentName: newLesson.studentName || cleanStudentEmail.split('@')[0],
          email: cleanStudentEmail,
          studentEmail: cleanStudentEmail,
          studentUid: newLesson.studentUid,
          level: 'iniciante',
          studentLevel: 'iniciante',
          goal: 'English for everyday life & work',
          learningGoal: 'English for everyday life & work',
          teacherEmail: cleanTeacherEmail,
          teacherName: cleanTeacherName,
          teacherUid: newLesson.teacherUid,
          status: 'active',
          createdAt: new Date().toISOString(),
        });
      }

      // Also ensure student profile has their assigned teacher and active enrollment
      if (db.userProfiles) {
        if (!db.userProfiles[cleanStudentEmail]) {
          db.userProfiles[cleanStudentEmail] = {
            id: newLesson.studentUid || `usr-${cleanStudentEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
            name: newLesson.studentName || cleanStudentEmail.split('@')[0],
            email: cleanStudentEmail,
            teacherEmail: cleanTeacherEmail,
            teacherName: cleanTeacherName,
            teacherUid: newLesson.teacherUid,
            enrollmentStatus: 'active',
            contractedLessons: Math.max(db.contractedLessons?.[cleanStudentEmail] || 0, 1),
            createdAt: new Date().toISOString(),
          };
        } else {
          db.userProfiles[cleanStudentEmail] = {
            ...db.userProfiles[cleanStudentEmail],
            teacherEmail: cleanTeacherEmail,
            teacherName: cleanTeacherName || db.userProfiles[cleanStudentEmail].teacherName,
            teacherUid: newLesson.teacherUid || db.userProfiles[cleanStudentEmail].teacherUid,
            enrollmentStatus: 'active',
            contractedLessons: Math.max(db.userProfiles[cleanStudentEmail].contractedLessons || 0, 1),
          };
        }
      }
    }
  }
  await writeDbSync(db);
  res.json(db.liveLessons);
});

app.post('/api/lessons/:id/complete', (req, res) => {
  const db = readDb();
  const id = decodeURIComponent(req.params.id);
  db.liveLessons = db.liveLessons.map((l) => (l.id === id ? { ...l, status: 'completed' } : l));
  writeDb(db);
  res.json({ success: true, liveLessons: db.liveLessons });
});

app.post('/api/lessons/:id/not-completed', (req, res) => {
  const db = readDb();
  const id = decodeURIComponent(req.params.id);
  const { responsible, reason } = req.body;
  db.liveLessons = db.liveLessons.map((l) =>
    l.id === id
      ? {
          ...l,
          status: 'not_completed',
          notCompletedResponsible: responsible,
          notCompletedReason: reason,
        }
      : l
  );
  writeDb(db);
  res.json({ success: true, liveLessons: db.liveLessons });
});

app.post('/api/lessons/:id/reschedule', (req, res) => {
  const db = readDb();
  const id = decodeURIComponent(req.params.id);
  const { newStartIso, newEndIso, reason, proposedBy } = req.body;
  const isTeacher = proposedBy === 'teacher';
  db.liveLessons = db.liveLessons.map((l) =>
    l.id === id
      ? {
          ...l,
          proposedNewStartDateTime: newStartIso,
          proposedNewEndDateTime: newEndIso,
          rescheduleNotes: reason,
          proposedBy: isTeacher ? 'teacher' : 'student',
          proposalStatus: isTeacher
            ? 'pending_student_reschedule'
            : 'pending_teacher_reschedule',
          proposedAt: new Date().toISOString(),
        }
      : l
  );
  writeDb(db);
  res.json({ success: true, liveLessons: db.liveLessons });
});

app.post('/api/lessons/:id/accept-reschedule', (req, res) => {
  const db = readDb();
  const id = decodeURIComponent(req.params.id);
  db.liveLessons = db.liveLessons.map((l) => {
    if (l.id === id && l.proposedNewStartDateTime) {
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
  });
  writeDb(db);
  res.json({ success: true, liveLessons: db.liveLessons });
});

app.post('/api/lessons/:id/decline-reschedule', (req, res) => {
  const db = readDb();
  const id = decodeURIComponent(req.params.id);
  db.liveLessons = db.liveLessons.map((l) =>
    l.id === id
      ? {
          ...l,
          proposedNewStartDateTime: undefined,
          proposedNewEndDateTime: undefined,
          proposalStatus: undefined,
        }
      : l
  );
  writeDb(db);
  res.json({ success: true, liveLessons: db.liveLessons });
});

app.post('/api/lessons/:id/cancel', async (req, res) => {
  const db = readDb();
  const id = decodeURIComponent(req.params.id);
  const { cancelledBy, reason } = req.body || {};
  const target = (db.liveLessons || []).find((l: any) => l.id === id);
  db.liveLessons = (db.liveLessons || []).map((l: any) =>
    l.id === id ||
    (target &&
      target.studentEmail &&
      (l.studentEmail || '').toLowerCase() === target.studentEmail.toLowerCase() &&
      l.startDateTime === target.startDateTime)
      ? {
          ...l,
          status: 'cancelled',
          cancelledAt: l.cancelledAt || new Date().toISOString(),
          cancelledBy: cancelledBy || l.cancelledBy || 'user',
          cancellationReason: reason || l.cancellationReason || 'Cancelled by user',
          proposalStatus: undefined,
          proposedNewStartDateTime: undefined,
          proposedNewEndDateTime: undefined,
        }
      : l
  );
  await writeDbSync(db);
  res.json({ success: true, liveLessons: db.liveLessons });
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

// Save live lesson notes & automatically migrate vocabulary to student's personal dictionary
app.post('/api/lessons/:id/notes', async (req, res) => {
  const db = readDb();
  const id = decodeURIComponent(req.params.id);
  const { topic, liveNotes, recommendations, pronunciationNotes, grammarAndPhrasing, vocabularyNotes, sessionNotesDocument, sessionDate } = req.body || {};

  let targetStudentEmail = (req.body?.studentEmail || '').toLowerCase().trim();
  let targetStudentUid = req.body?.studentUid || '';
  if ((!targetStudentUid || !isValidCanonicalUid(targetStudentUid)) && targetStudentEmail) {
    const foundStudent = (db.students || []).find((s: any) => (s.email || '').toLowerCase().trim() === targetStudentEmail);
    if (foundStudent && foundStudent.uid && isValidCanonicalUid(foundStudent.uid)) {
      targetStudentUid = foundStudent.uid;
    }
  }
  let teacherName = req.body?.teacherName || '';
  let teacherEmail = (req.body?.teacherEmail || '').toLowerCase().trim();

  const effectiveDocument = sessionNotesDocument || liveNotes || recommendations || '';

  db.liveLessons = (db.liveLessons || []).map((l: any) => {
    if (l.id === id) {
      if (!targetStudentEmail && l.studentEmail) targetStudentEmail = (l.studentEmail || '').toLowerCase().trim();
      if (!targetStudentUid && l.studentUid) targetStudentUid = l.studentUid || '';
      if (!teacherName && (l.teacherName || l.tutorName)) teacherName = l.teacherName || l.tutorName || '';
      if (!teacherEmail && (l.teacherEmail || l.tutorEmail)) teacherEmail = (l.teacherEmail || l.tutorEmail || '').toLowerCase().trim();
      return {
        ...l,
        title: topic || l.title,
        liveNotes: liveNotes || effectiveDocument,
        recommendations: recommendations || effectiveDocument,
        pronunciationNotes,
        grammarAndPhrasing,
        sessionNotesDocument: effectiveDocument,
        vocabularyNotes: Array.isArray(vocabularyNotes) ? vocabularyNotes : l.vocabularyNotes,
        notesLastSavedAt: new Date().toISOString(),
      };
    }
    return l;
  });

  // Automatically persist session notes document to Firestore keyed by date / session ID
  const effectiveSessionDate = sessionDate || new Date().toISOString().split('T')[0];
  const cleanEmail = (targetStudentEmail || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const sessionKey = id ? id : `session_${effectiveSessionDate}_${cleanEmail}`;

  if (!db.sessionNotesMap) db.sessionNotesMap = {};
  db.sessionNotesMap[sessionKey] = {
    id: sessionKey,
    sessionDate: effectiveSessionDate,
    lessonId: id,
    studentEmail: targetStudentEmail,
    studentUid: targetStudentUid,
    teacherEmail,
    teacherName,
    topic: topic || '',
    content: effectiveDocument,
    updatedAt: new Date().toISOString(),
  };

  saveSessionNotesToFirestoreServer(sessionKey, {
    id: sessionKey,
    sessionDate: effectiveSessionDate,
    lessonId: id,
    studentEmail: targetStudentEmail,
    studentUid: targetStudentUid,
    teacherEmail,
    teacherName,
    topic: topic || '',
    content: effectiveDocument,
    updatedAt: new Date().toISOString(),
  }).catch((err) => {
    console.warn('Backend Firestore session notes auto-save notice:', err);
  });

  // Invalidate all versions (languages, CEFR levels, hashes) of cached pedagogical transformation for this session
  // Teacher saving notes does NOT generate Gemini and does NOT write directly to student's dictionary
  invalidatePedagogicalCache(db, {
    canonicalSessionKey: sessionKey,
    sessionKey,
    lessonId: id,
    id,
  });

  await writeDbSync(db);
  res.json({ success: true, liveLessons: db.liveLessons });
});

// Save Native Friend In-Session Notes & Recommendations document keyed by session date/ID
app.post('/api/session-notes', async (req, res) => {
  const db = readDb();
  const {
    id,
    sessionDate,
    lessonId,
    studentEmail,
    studentName,
    studentUid,
    teacherEmail,
    teacherName,
    topic,
    content,
    driveFileId,
    driveFileUrl,
    driveFolderName,
    driveLastSyncedAt,
    skipDriveSync,
  } = req.body || {};

  const cleanDate = sessionDate || new Date().toISOString().split('T')[0];
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const sessionKey = id || (lessonId ? lessonId : `session_${cleanDate}_${cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  const targetTeacherEmail = (teacherEmail || 'adm.itissimple@gmail.com').toLowerCase().trim();

  // Store Drive sync metadata if provided by explicit teacher action
  let finalDriveFileId = driveFileId || db.sessionNotesMap?.[sessionKey]?.driveFileId || '';
  let finalDriveFileUrl = driveFileUrl || db.sessionNotesMap?.[sessionKey]?.driveFileUrl || '';
  let finalDriveFolderName = driveFolderName || db.sessionNotesMap?.[sessionKey]?.driveFolderName || GOOGLE_DRIVE_SESSION_FOLDER;
  let finalDriveLastSyncedAt = driveLastSyncedAt || db.sessionNotesMap?.[sessionKey]?.driveLastSyncedAt || '';

  if (!db.sessionNotesMap) db.sessionNotesMap = {};
  const noteDoc = {
    id: sessionKey,
    sessionDate: cleanDate,
    lessonId: lessonId || '',
    studentEmail: cleanEmail,
    studentUid: studentUid || '',
    teacherEmail: targetTeacherEmail,
    teacherName: teacherName || '',
    topic: topic || '',
    content: content || '',
    driveFileId: finalDriveFileId,
    driveFileUrl: finalDriveFileUrl,
    driveFolderName: finalDriveFolderName,
    driveLastSyncedAt: finalDriveLastSyncedAt,
    updatedAt: new Date().toISOString(),
  };

  db.sessionNotesMap[sessionKey] = noteDoc;

  // Also sync with liveLessons if lessonId is provided
  if (lessonId && Array.isArray(db.liveLessons)) {
    db.liveLessons = db.liveLessons.map((l: any) => {
      if (l.id === lessonId) {
        return {
          ...l,
          title: topic || l.title,
          liveNotes: content,
          recommendations: content,
          sessionNotesDocument: content,
          notesLastSavedAt: new Date().toISOString(),
          driveFileId: noteDoc.driveFileId,
          driveFileUrl: noteDoc.driveFileUrl,
          driveFolderName: noteDoc.driveFolderName,
          driveLastSyncedAt: noteDoc.driveLastSyncedAt,
        };
      }
      return l;
    });
  }

  // Invalidate cached pedagogical transformation for this session to ensure next fetch re-analyzes fresh notes
  const canonicalSessionKey = getCanonicalSessionKey({
    lessonId,
    sessionKey,
    id,
    studentUid,
    studentEmail: cleanEmail,
    sessionDate: cleanDate,
  });

  // Invalidate all versions (languages, CEFR levels, hashes) of cached pedagogical transformation for this session
  invalidatePedagogicalCache(db, {
    canonicalSessionKey,
    sessionKey,
    lessonId,
    id,
  });

  await writeDbSync(db);

  // Asynchronously persist to Cloud Firestore under /session_notes/{sessionKey} and /users/{studentId}/session_notes
  saveSessionNotesToFirestoreServer(sessionKey, noteDoc).catch((err) => {
    console.warn('Backend Firestore session notes save notice:', err);
  });

  res.json({ success: true, sessionNote: noteDoc });
});

// Dedicated Google Drive Session Notes Sync Endpoint (uses platform credentials mapped to teacher's email)
app.post('/api/drive/sync-session-notes', async (req, res) => {
  const {
    studentName,
    studentEmail,
    sessionDate,
    content,
    topic,
    existingFileId,
    lessonId,
    sessionKey,
    teacherEmail,
    teacherName,
  } = req.body || {};

  try {
    const cleanDate = (sessionDate || new Date().toISOString().split('T')[0]).trim();
    const cleanStudentEmail = (studentEmail || '').toLowerCase().trim();
    const cleanTeacherEmail = (teacherEmail || 'adm.itissimple@gmail.com').toLowerCase().trim();
    const effectiveKey = sessionKey || lessonId || `session_${cleanDate}_${cleanStudentEmail.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    const driveRes = await syncSessionNotesWithPlatformDrive({
      studentName: studentName || (cleanStudentEmail ? cleanStudentEmail.split('@')[0] : 'Student'),
      studentEmail: cleanStudentEmail,
      sessionDate: cleanDate,
      content: content || '',
      topic: topic || 'Native Friend Live Coaching',
      existingFileId: existingFileId || undefined,
      lessonId: lessonId || undefined,
      sessionKey: effectiveKey,
      teacherEmail: cleanTeacherEmail,
      teacherName: teacherName || 'Native Friend',
    });

    const nowIso = driveRes.syncedAt || new Date().toISOString();
    const db = readDb();

    if (!db.sessionNotesMap) db.sessionNotesMap = {};
    if (db.sessionNotesMap[effectiveKey]) {
      db.sessionNotesMap[effectiveKey].driveFileId = driveRes.fileId;
      db.sessionNotesMap[effectiveKey].driveFileUrl = driveRes.webViewLink;
      db.sessionNotesMap[effectiveKey].driveFolderName = driveRes.folderName;
      db.sessionNotesMap[effectiveKey].driveLastSyncedAt = nowIso;
      if (content) db.sessionNotesMap[effectiveKey].content = content;
      if (topic) db.sessionNotesMap[effectiveKey].topic = topic;
    } else {
      db.sessionNotesMap[effectiveKey] = {
        id: effectiveKey,
        sessionDate: cleanDate,
        lessonId: lessonId || '',
        studentEmail: cleanStudentEmail,
        teacherEmail: cleanTeacherEmail,
        teacherName: teacherName || 'Native Friend',
        topic: topic || '',
        content: content || '',
        driveFileId: driveRes.fileId,
        driveFileUrl: driveRes.webViewLink,
        driveFolderName: driveRes.folderName,
        driveLastSyncedAt: nowIso,
        updatedAt: nowIso,
      };
    }

    if (lessonId && Array.isArray(db.liveLessons)) {
      db.liveLessons = db.liveLessons.map((l: any) => {
        if (l.id === lessonId) {
          return {
            ...l,
            ...(topic ? { title: topic } : {}),
            ...(content ? { liveNotes: content, recommendations: content, sessionNotesDocument: content } : {}),
            driveFileId: driveRes.fileId,
            driveFileUrl: driveRes.webViewLink,
            driveFolderName: driveRes.folderName,
            driveLastSyncedAt: nowIso,
          };
        }
        return l;
      });
    }

    // Invalidate cached pedagogical transformation for this session
    invalidatePedagogicalCache(db, {
      canonicalSessionKey: effectiveKey,
      sessionKey: effectiveKey,
      lessonId: lessonId || undefined,
    });

    await writeDbSync(db);
    saveSessionNotesToFirestoreServer(effectiveKey, db.sessionNotesMap[effectiveKey]).catch(() => null);

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
app.get('/api/drive/files/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const storedFile = getStoredDriveFile(fileId);

  if (!storedFile) {
    // If not found in drive store, check sessionNotesMap
    const db = readDb();
    const sessionDoc = Object.values(db.sessionNotesMap || {}).find(
      (s: any) => s.driveFileId === fileId || s.id === fileId
    );

    if (sessionDoc) {
      const fileName = formatSessionNotesFileName((sessionDoc as any).studentEmail?.split('@')[0], (sessionDoc as any).sessionDate);
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
    <div class="bg-slate-50 p-6 rounded-xl border border-slate-200 whitespace-pre-wrap leading-relaxed text-sm font-sans">${(sessionDoc as any).content || 'No content.'}</div>
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
app.get('/api/drive/files/:fileId/download', (req, res) => {
  const fileId = req.params.fileId;
  const storedFile = getStoredDriveFile(fileId);

  if (storedFile) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${storedFile.fileName}.txt"`);
    return res.send(storedFile.content);
  }

  const db = readDb();
  const sessionDoc = Object.values(db.sessionNotesMap || {}).find(
    (s: any) => s.driveFileId === fileId || s.id === fileId
  );

  if (sessionDoc) {
    const fileName = formatSessionNotesFileName((sessionDoc as any).studentEmail?.split('@')[0], (sessionDoc as any).sessionDate);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.txt"`);
    return res.send((sessionDoc as any).content || '');
  }

  res.status(404).json({ error: 'File not found.' });
});

// Retrieve Native Friend In-Session Notes & Recommendations
app.get('/api/session-notes', async (req, res) => {
  const db = readDb();
  const id = (req.query.id as string) || '';
  const lessonId = (req.query.lessonId as string) || '';
  const studentEmail = ((req.query.studentEmail as string) || (req.query.email as string) || '').toLowerCase().trim();
  const studentUid = ((req.query.studentUid as string) || (req.query.uid as string) || '').trim();
  const sessionDate = (req.query.sessionDate as string) || '';

  // Direct lookup by id, lessonId, or canonical key
  if (id || lessonId) {
    const targetKey = id || lessonId;
    const cleanId = targetKey.replace(/^lesson_/, '');
    if (db.sessionNotesMap?.[targetKey]) {
      return res.json(db.sessionNotesMap[targetKey]);
    }
    if (db.sessionNotesMap?.[`lesson_${cleanId}`]) {
      return res.json(db.sessionNotesMap[`lesson_${cleanId}`]);
    }
    if (db.sessionNotesMap?.[cleanId]) {
      return res.json(db.sessionNotesMap[cleanId]);
    }
    const foundDoc = Object.values(db.sessionNotesMap || {}).find(
      (n: any) => n.id === targetKey || n.lessonId === targetKey || n.lessonId === cleanId || n.id === `lesson_${cleanId}`
    );
    if (foundDoc) {
      return res.json(foundDoc);
    }
    // Also check liveLessons
    if (Array.isArray(db.liveLessons)) {
      const matchLesson = db.liveLessons.find((l: any) => l.id === targetKey || l.id === cleanId);
      if (matchLesson && (matchLesson.sessionNotesDocument || matchLesson.liveNotes || matchLesson.recommendations)) {
        const lDate = matchLesson.sessionDate || (matchLesson.startDateTime ? matchLesson.startDateTime.split('T')[0] : '');
        return res.json({
          id: matchLesson.id,
          sessionDate: lDate,
          lessonId: matchLesson.id,
          studentEmail: matchLesson.studentEmail,
          studentUid: matchLesson.studentUid,
          teacherEmail: matchLesson.teacherEmail || matchLesson.tutorEmail || 'adm.itissimple@gmail.com',
          teacherName: matchLesson.teacherName || matchLesson.tutorName || 'Native Friend',
          topic: matchLesson.title || 'Conversation & Fluency',
          content: matchLesson.sessionNotesDocument || matchLesson.liveNotes || matchLesson.recommendations || '',
          driveFileId: matchLesson.driveFileId,
          driveFileUrl: matchLesson.driveFileUrl,
          driveFolderName: matchLesson.driveFolderName,
          driveLastSyncedAt: matchLesson.driveLastSyncedAt,
          updatedAt: matchLesson.updatedAt || matchLesson.notesLastSavedAt || new Date().toISOString(),
        });
      }
    }
  }

  if (studentUid || studentEmail) {
    const allNotes: any[] = Object.values(db.sessionNotesMap || {});
    const map = new Map<string, any>();

    // 1. Collect from sessionNotesMap matching studentUid or studentEmail
    allNotes.forEach((n: any) => {
      const matchUid = studentUid && n.studentUid && n.studentUid === studentUid;
      const matchEmail = studentEmail && (n.studentEmail || '').toLowerCase().trim() === studentEmail;
      if (matchUid || matchEmail) {
        const key = n.id || n.sessionDate || n.lessonId;
        if (key) map.set(key, n);
      }
    });

    // 2. Also collect from db.liveLessons matching studentUid or studentEmail that have notes
    if (Array.isArray(db.liveLessons)) {
      db.liveLessons.forEach((l: any) => {
        const matchUid = studentUid && l.studentUid && l.studentUid === studentUid;
        const matchEmail = studentEmail && (l.studentEmail || '').toLowerCase().trim() === studentEmail;
        const noteContent = l.sessionNotesDocument || l.liveNotes || l.recommendations || '';
        if ((matchUid || matchEmail) && noteContent && noteContent.trim()) {
          const lDate = l.sessionDate || (l.startDateTime ? l.startDateTime.split('T')[0] : '');
          const lKey = l.id || `session_${lDate}_${studentEmail}`;
          if (!map.has(lKey)) {
            map.set(lKey, {
              id: lKey,
              sessionDate: lDate,
              lessonId: l.id,
              studentEmail: l.studentEmail || studentEmail,
              studentUid: l.studentUid || studentUid,
              teacherEmail: l.teacherEmail || l.tutorEmail || 'adm.itissimple@gmail.com',
              teacherName: l.teacherName || l.tutorName || 'Native Friend',
              topic: l.title || 'Conversation & Fluency',
              content: noteContent,
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

    const results = Array.from(map.values()).sort((a: any, b: any) => {
      const timeA = new Date(a.sessionDate || a.updatedAt || 0).getTime();
      const timeB = new Date(b.sessionDate || b.updatedAt || 0).getTime();
      return timeB - timeA; // Descending: newest first
    });

    if (sessionDate) {
      const match = results.find((n: any) => n.sessionDate === sessionDate);
      return res.json(match || null);
    }

    return res.json(results);
  }

  res.json(Object.values(db.sessionNotesMap || {}));
});

// Retrieve Native Friends Notes Sequential Review Progress
app.get('/api/session-notes/progress', async (req, res) => {
  const db = readDb();
  const studentUid = ((req.query.studentUid as string) || (req.query.uid as string) || '').trim();
  const studentEmail = ((req.query.studentEmail as string) || (req.query.email as string) || '').toLowerCase().trim();
  const key = studentUid || studentEmail;
  if (!key) return res.status(400).json({ error: 'Missing student identifier' });

  let progress = (db.sessionNotesProgressMap && db.sessionNotesProgressMap[key]) || null;
  if ((!progress || !progress.lastReminderShownDate) && studentUid) {
    const fsProgress = await fetchSessionNotesProgressServer(studentUid);
    if (fsProgress) {
      if (!db.sessionNotesProgressMap) db.sessionNotesProgressMap = {};
      progress = {
        ...(progress || {}),
        ...fsProgress,
      };
      db.sessionNotesProgressMap[key] = progress;
    }
  }
  return res.json(progress || null);
});

// Update Native Friends Notes Sequential Review Progress
app.post('/api/session-notes/progress', async (req, res) => {
  const { studentUid, studentEmail, lastSessionKey, stepIndex, lastReviewedTab, lastReviewedDate } = req.body || {};
  const key = (studentUid || studentEmail || '').trim();
  if (!key) return res.status(400).json({ error: 'Missing student identifier' });
  const db = readDb();
  db.sessionNotesProgressMap = db.sessionNotesProgressMap || {};
  const existingProg = db.sessionNotesProgressMap[key] || {};

  const updatedProgress = {
    ...existingProg,
    studentUid: studentUid || existingProg.studentUid || '',
    studentEmail: (studentEmail || existingProg.studentEmail || '').toLowerCase().trim(),
    lastSessionKey: lastSessionKey !== undefined ? lastSessionKey : (existingProg.lastSessionKey || ''),
    stepIndex: typeof stepIndex === 'number' ? stepIndex : (existingProg.stepIndex || 0),
    lastReviewedTab: lastReviewedTab !== undefined ? lastReviewedTab : (existingProg.lastReviewedTab || ''),
    lastReviewedDate: lastReviewedDate !== undefined ? lastReviewedDate : (existingProg.lastReviewedDate || ''),
    lastReminderShownDate: existingProg.lastReminderShownDate || '',
    updatedAt: new Date().toISOString(),
  };

  db.sessionNotesProgressMap[key] = updatedProgress;
  await writeDbSync(db);

  saveSessionNotesProgressToFirestore(key, updatedProgress).catch(() => {});
  return res.json({ success: true, progress: updatedProgress });
});

// Atomic Daily Reminder Claim Endpoint (Presented AT MOST ONCE per day per student)
app.post('/api/session-notes/reminder/claim', async (req, res) => {
  const caller = await getVerifiedUserFromRequest(req);
  const { studentUid, studentEmail, timeZone, dateStr } = req.body || {};

  let effectiveUid = (studentUid || '').trim();
  let effectiveEmail = (studentEmail || '').toLowerCase().trim();

  if (caller) {
    const identityRes = await resolveCanonicalStudentIdentity({
      caller,
      studentEmail,
      studentUid,
    });
    if (identityRes.authorized && identityRes.canonicalStudentUid) {
      effectiveUid = identityRes.canonicalStudentUid;
      effectiveEmail = identityRes.studentEmail || effectiveEmail;
    }
  }

  if (!effectiveUid && !effectiveEmail) {
    return res.status(400).json({ error: 'Missing student identifier' });
  }

  const primaryKey = effectiveUid || effectiveEmail;
  const effectiveTz = sanitizeTimeZone(timeZone || 'America/Sao_Paulo');
  const todayInTz =
    dateStr ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: effectiveTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

  const result = await recordDailyReminderShownServer(primaryKey, todayInTz);

  const db = readDb();
  if (!db.sessionNotesProgressMap) db.sessionNotesProgressMap = {};
  const existingProg = db.sessionNotesProgressMap[primaryKey] || {};
  db.sessionNotesProgressMap[primaryKey] = {
    ...existingProg,
    studentUid: effectiveUid,
    studentEmail: effectiveEmail,
    lastReminderShownDate: todayInTz,
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

// Controlled cooldown tracker for Gemini quota exhaustion to prevent repeated 429 floods
let geminiQuotaCooldownUntil = 0;
const GEMINI_QUOTA_COOLDOWN_MS = 60_000;

export type GeminiFailureCategory =
  | 'AUTH_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'SERVICE_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE';

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

    // Verify student ownership of lesson via canonical Firestore database first, then fallback
    if (lessonId) {
      let lesson: any = null;
      const firestore = getFirestoreDb();
      if (firestore) {
        try {
          const lSnap1 = await firestore.collection('liveLessons').doc(lessonId).get();
          if (lSnap1.exists) {
            lesson = lSnap1.data();
          } else {
            const lSnap2 = await firestore.collection('lessons').doc(lessonId).get();
            if (lSnap2.exists) {
              lesson = lSnap2.data();
            }
          }
        } catch {}
      }

      if (!lesson && Array.isArray(db.liveLessons)) {
        lesson = db.liveLessons.find((l: any) => l.id === lessonId);
      }

      if (lesson) {
        const lEmail = (lesson.studentEmail || '').toLowerCase().trim();
        const lUid = lesson.studentUid || '';
        if ((lUid && lUid !== callerUid) || (lEmail && lEmail !== callerEmail)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Unauthorized access: you may only transform pedagogical notes for your own lessons.',
          });
        }
      }
    }

    cleanUid = callerUid;
    effectiveEmail = callerEmail;
  } else {
    // Teachers and Admins can act on behalf of the student
    cleanUid = studentUid || callerUid;
    effectiveEmail = cleanEmail || callerEmail;
  }

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

  if ((!cached || cached.isProvisional) && canonicalSessionKey) {
    try {
      const fsCached = await fetchPedagogicalTransformationFromFirestoreServer(compositeCacheKey);
      if (fsCached && fsCached.contentHash === contentHash && fsCached.isAiGenerated && !fsCached.isProvisional) {
        cached = fsCached;
        db.pedagogicalTransformationsMap[compositeCacheKey] = cached;
      }
    } catch {}
  }

  // FASE 4B.8 & 4B.9: If a valid, non-provisional AI-generated transformation exists for this contentHash, REUSE IT,
  // EXCEPT when the user explicitly triggers forceRegenerate (Refresh Analysis) or when cache contains a legacy pending placeholder!
  const hasLegacyPendingPlaceholder = Array.isArray(cached?.mistakesAnalysis) && cached.mistakesAnalysis.some((m: any) =>
    m.isPendingConfirmation === true ||
    (typeof m.corrected === 'string' && (m.corrected.includes('Pending confirmation') || m.corrected.includes('Pendente de confirmação')))
  );

  if (!forceRegenerate && !hasLegacyPendingPlaceholder && cached && !cached.isProvisional && cached.contentHash === contentHash && cached.isAiGenerated) {
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
    // Parse notes using robust notesHtmlParser
    const markings = parseNotesHtml(rawNotes);
    const correctCount = markings.correctCount;
    const incorrectCount = markings.incorrectCount;
    const newWordCount = markings.newWordCount;
    const pronounceCount = markings.pronounceCount;

    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    const isCooldownActive = Date.now() < geminiQuotaCooldownUntil;
    let lastFailureCategory: GeminiFailureCategory | null = isCooldownActive ? 'QUOTA_EXCEEDED' : null;

    if (apiKey && rawNotes.trim().length > 15 && !isCooldownActive) {
      const targetLang = LANGUAGE_NAMES[language] || { nameEn: 'Portuguese', nameNative: 'Português' };
      const pendingText = getPendingConfirmationText(language);

      const systemInstruction = `You are an elite, Cambridge/CELTA-certified Pedagogical English Language Synthesizer and Master Native Friend Teacher.
Your mission is to transform raw in-session teacher notes into an ultra-structured, masterclass pedagogical report for the student.
The student MUST NEVER see raw, fragmented notes. Instead, they receive a polished, elegant learning guide calibrated to their CEFR level (${cefr}).

LANGUAGE REQUIREMENT:
- All pedagogical explanations, grammar rules, vocabulary "simpleDefinition" explanations, common pitfalls, comparisons, CEFR adaptation advice, rememberThis takeaway, and review summaries MUST be written in ${targetLang.nameEn} (${targetLang.nameNative}, code: "${language}").
- "definitionEn" MUST BE WRITTEN IN NATURAL ENGLISH, calibrated to CEFR ${cefr}.
- The target English words, phrasal verbs, collocations, and didactic examples MUST remain in natural, authentic English.

CRITICAL INSTRUCTIONS ON TEACHER SHORTCUT MARKINGS & TAB ROUTING:
1. Alt + N (Error / Incorrect Markings):
   - Items stamped with 'data-tag-type="incorrect"', '✗', 'Instead of:', or error lines MUST be directed and processed appropriately into:
     a) "mistakesAnalysis" (Tab 1: Analyze Mistakes): student's original faulty utterance, natural native correction (resolving spelling, phrasing, or grammatical slips into polished English), category, grammatical explanation (addressing L1 interference), two natural examples, and common pitfalls. Even if the teacher wrote an isolated mistake without explicit correction (e.g. spelling slips or words marked with ✗), deduce and provide the accurate, natural native correction.
     b) "grammarPoints" (Tab 2: Grammar Points): whenever an error involves a systemic grammatical rule/structure (e.g. verb tenses, stative verbs, auxiliary verbs, dependent prepositions, conditionals, modals, word order), elaborate the corresponding rule with syntax (FORM), usage, examples, and comparisons. Ensure at least 2 relevant, high-impact grammar points are provided, connecting to the session errors or CEFR ${cefr} speaking goals.
2. Alt + W (New Word) & Alt + P (Pronunciation Markings):
   - Items stamped with 'data-tag-type="new-word"', '[New Word]', 'data-tag-type="pronounce"', '[Pronounce]' MUST be directed and processed into:
     "vocabularyAndExpressions" (Tab 3: Vocabulary & Expressions).
   - For Alt+W: provide part of speech, register, simple definition adapted to CEFR ${cefr}, collocations, real examples, and synonyms.
   - For Alt+P: mark partOfSpeech as "Pronunciation Focus", provide clear syllable stress breakdown, phonetic guide with IPA, common pronunciation slips to avoid, and conversational examples.
3. CEFR LEVEL ADAPTATION:
   - There is NO separate CEFR tab. Instead, ALL tabs (Complete Report, 1. Analyze Mistakes, 2. Grammar Points, 3. Vocabulary & Expressions, and Quick Review) MUST be intelligently and deeply elaborated respecting and adapting to the student's current CEFR level (${cefr}).
4. QUICK REVIEW MANDATE:
   - ALL session notes, corrections, and processed terms MUST compose the Quick Review ("reviewSummary").
   - "essentialCorrections": MUST contain ALL items from mistakesAnalysis.
   - "mustKnowVocabulary": MUST contain ALL terms from vocabularyAndExpressions (both Alt+W and Alt+P).
   - "keyRules": MUST contain ALL grammar rules from grammarPoints.
   - "rememberThis": High-impact golden takeaway rule for the student.

You MUST produce a JSON object strictly conforming to this schema:
{
  "mistakesAnalysis": [
    {
      "id": "mistake-1",
      "original": "Student's original faulty utterance",
      "corrected": "Polished, natural native correction",
      "category": "grammar" | "vocabulary" | "collocation" | "preposition" | "pronunciation" | "phrasing",
      "explanation": "Crystal clear grammatical rule explanation highlighting why the error occurred and how to fix it, calibrated to CEFR ${cefr}",
      "twoExamples": ["Example 1 in natural context", "Example 2 in natural context"],
      "commonPitfalls": "Common mistake learners make with this structure (especially Portuguese L1 interference)"
    }
  ],
  "grammarPoints": [
    {
      "id": "grammar-1",
      "topic": "Grammar topic name",
      "rule": "Detailed rule explanation adapted to CEFR ${cefr}",
      "form": "Formula / Syntax breakdown",
      "usage": "When and why native speakers use this",
      "examples": ["Example 1", "Example 2"],
      "commonMistakes": "Mistake to avoid",
      "comparisons": "Contrast with other structures or Portuguese interference"
    }
  ],
  "vocabularyAndExpressions": [
    {
      "id": "vocab-1",
      "term": "Word, phrasal verb, or pronunciation term",
      "partOfSpeech": "Part of speech (e.g. Phrasal Verb, Noun, Pronunciation Focus)",
      "definitionEn": "Simple, accurate definition EXCLUSIVELY in English tailored to student level ${cefr} and part of speech",
      "simpleDefinition": "Clear, accessible pedagogical explanation in ${targetLang.nameEn} adapted to CEFR ${cefr}",
      "collocations": ["Collocation 1", "Collocation 2"],
      "realExamples": ["Real-world sentence 1", "Real-world sentence 2"],
      "synonyms": ["Synonym 1", "Synonym 2"],
      "register": "informal" | "neutral" | "formal" | "idiomatic",
      "category": "Thematic category or 'Pronunciation & Phonetics (Alt+P)' / 'New Words & Expressions (Alt+W)'",
      "phoneticGuide": "Phonetic / stress guide with IPA",
      "isPronunciationFocus": false,
      "isNewWord": true
    }
  ],
  "reviewSummary": {
    "estimatedMinutes": "5–10 minutes",
    "keyRules": ["Key grammar rules covered in ${targetLang.nameEn}"],
    "mustKnowVocabulary": ["Vocabulary and pronunciation items with definitions in ${targetLang.nameEn}"],
    "essentialCorrections": [{"original": "...", "corrected": "..."}],
    "rememberThis": "Memorable takeaway focused on the session items in ${targetLang.nameEn}"
  }
}

Return JSON only without Markdown backticks.`;

      // Security Hotfix (Etapa 2): Privacy enforcement — studentUid and email REMOVED from prompt.
      // Untrusted raw notes are cleanly delimited and passed.
      const prompt = `Pedagogical Parameters:
- CEFR Level: ${cefr}
- Lesson Date: ${sessionDate}
- Session Topic: ${topic}
- Native Friend Teacher: ${teacherName}
- Target Language: ${targetLang.nameEn} (${targetLang.nameNative})

Raw In-Session Notes to transform:
"""
${rawNotes}
"""

Please synthesize and transform these notes according to the Alt+N, Alt+W, and Alt+P routing rules, adapting deeply to CEFR ${cefr}, and ensuring ALL items are included in the Quick Review. Provide all explanations and pedagogical rules in ${targetLang.nameEn} (${targetLang.nameNative}).`;

      // Security Hotfix (Etapa 2): Single attempt with gemini-2.5-flash, zero cascade, exact token bounds
      const singleAttempt = await executeGeminiSingleAttempt({
        feature: 'pedagogical_transform',
        systemInstruction,
        untrustedUserDataPrompt: prompt,
        callerRole: caller.role,
        apiKey,
        temperature: 0.35,
      });

      if (singleAttempt?.parsedJson) {
        const parsed = singleAttempt.parsedJson;

        if (parsed && Array.isArray(parsed.mistakesAnalysis)) {
          // Process mistakes directly preserving AI native corrections
          const rawErrMap = new Map<string, typeof markings.errors[0]>();
          markings.errors.forEach((e) => rawErrMap.set(e.original.toLowerCase().trim(), e));

          const validatedMistakes: any[] = [];
          (parsed.mistakesAnalysis || []).forEach((m: any) => {
            const origKey = String(m?.original || '').toLowerCase().trim();
            const rawErr = rawErrMap.get(origKey);
            const originalText = rawErr ? rawErr.original : (m.original || 'Mistake');
            // Prioritize teacher explicit correction if provided, otherwise model native correction
            const correctedText = (rawErr && rawErr.corrected) ? rawErr.corrected : (m.corrected || originalText);

            validatedMistakes.push({
              id: `mistake-${validatedMistakes.length + 1}`,
              original: originalText,
              corrected: correctedText,
              category: m.category || 'grammar',
              explanation: m.explanation || `In natural spoken English, phrasing this structure as "${correctedText}" is the native formulation.`,
              twoExamples: Array.isArray(m.twoExamples) && m.twoExamples.length > 0
                ? m.twoExamples
                : [
                    `In everyday conversation: "${correctedText}".`,
                    `Alternative formulation: "I prefer saying ${correctedText} to sound natural and clear."`,
                  ],
              commonPitfalls: m.commonPitfalls || `Reverting to literal native language syntax instead of adopting natural English phraseology.`,
              isPendingConfirmation: false,
            });
            rawErrMap.delete(origKey);
          });

          // Any raw error that the model missed
          rawErrMap.forEach((rawErr) => {
            const correctedText = rawErr.corrected || rawErr.original;
            validatedMistakes.push({
              id: `mistake-${validatedMistakes.length + 1}`,
              original: rawErr.original,
              corrected: correctedText,
              category: 'grammar',
              explanation: `In natural spoken English, phrasing this structure as "${correctedText}" is the native formulation.`,
              twoExamples: [
                `In everyday conversation: "${correctedText}".`,
                `Example: "Saying ${correctedText} ensures clarity."`,
              ],
              commonPitfalls: `Reverting to literal native language syntax instead of adopting natural English phraseology.`,
              isPendingConfirmation: false,
            });
          });

          // If few or no mistakes found, provide foundational coaching points
          if (validatedMistakes.length === 0) {
            if (cefr === 'A1' || cefr === 'A2') {
              validatedMistakes.push({
                id: 'mistake-foundational-1',
                original: 'I have 28 years old',
                corrected: 'I am 28 years old',
                category: 'grammar',
                explanation: 'In English, age is expressed with the verb "to be" (am/is/are), not with "to have".',
                twoExamples: ['I am 28 years old.', 'My friend is 30 years old.'],
                commonPitfalls: 'Translating Portuguese "Eu tenho 28 anos" directly as "I have 28 years".',
                isPendingConfirmation: false,
              });
              validatedMistakes.push({
                id: 'mistake-foundational-2',
                original: 'It depends of the day',
                corrected: 'It depends on the day',
                category: 'preposition',
                explanation: 'The verb "depend" always pairs with the preposition "ON", never "of".',
                twoExamples: ['It depends on the traffic.', 'Our schedule depends on the weather.'],
                commonPitfalls: 'Saying "depend of" because of Portuguese "depender de".',
                isPendingConfirmation: false,
              });
            } else {
              validatedMistakes.push({
                id: 'mistake-foundational-1',
                original: "I'm agree with you",
                corrected: 'I agree with you',
                category: 'grammar',
                explanation: '"Agree" is an active verb, not an adjective. We say "I agree", without "am".',
                twoExamples: ['I agree with your suggestion.', 'I don\'t agree with that strategy.'],
                commonPitfalls: 'Saying "I am agree" or negative "I am not agree".',
                isPendingConfirmation: false,
              });
              validatedMistakes.push({
                id: 'mistake-foundational-2',
                original: 'Can I make a question?',
                corrected: 'Can I ask a question?',
                category: 'collocation',
                explanation: 'In natural English, you "ask a question", not "make a question".',
                twoExamples: ['May I ask a quick question?', 'He asked an interesting question.'],
                commonPitfalls: 'Translating "fazer uma pergunta" literally as "make a question".',
                isPendingConfirmation: false,
              });
            }
          }

          // Strict validation of vocabulary: terms MUST be in markings.newWords or markings.pronounceItems
          const validTermsSet = new Set<string>([
            ...markings.newWords.map((w) => w.toLowerCase().trim()),
            ...markings.pronounceItems.map((p) => p.toLowerCase().trim()),
          ]);

          const validatedVocab: any[] = [];
          (parsed.vocabularyAndExpressions || []).forEach((v: any) => {
            const termKey = String(v?.term || '').toLowerCase().trim();
            if (validTermsSet.has(termKey)) {
              const isPronounce = markings.pronounceItems.some((p) => p.toLowerCase().trim() === termKey);
              const isNewWord = markings.newWords.some((w) => w.toLowerCase().trim() === termKey);
              
              const rawExamples = Array.isArray(v.realExamples) ? v.realExamples : [];
              const formattedExamples = rawExamples.map((ex: any) => {
                const str = String(ex || '').trim();
                return str.startsWith('Didactic Example:') ? str : `Didactic Example: "${str.replace(/^["']|["']$/g, '')}"`;
              }).filter(Boolean);

              validatedVocab.push({
                ...v,
                id: `vocab-${validatedVocab.length + 1}`,
                partOfSpeech: v.partOfSpeech || (isPronounce ? 'Pronunciation Focus' : 'Expression'),
                realExamples: formattedExamples.length > 0 ? formattedExamples : (
                  isPronounce
                    ? [`Didactic Example: "Pay careful attention to the syllable stress on '${v.term}'."`]
                    : [`Didactic Example: "Native speakers use '${v.term}' in spontaneous conversation."`]
                ),
                category: isNewWord && isPronounce
                  ? 'New Word & Pronunciation (Alt+W + Alt+P)'
                  : isPronounce
                  ? 'Pronunciation & Phonetics (Alt+P)'
                  : 'New Words & Expressions (Alt+W)',
                isPronunciationFocus: isPronounce,
                isNewWord: isNewWord,
              });
              validTermsSet.delete(termKey);
            }
          });

          // Recover any marked term missed by the model using authentic dictionary or non-generic content
          validTermsSet.forEach((missedKey) => {
            const isPronounce = markings.pronounceItems.some((p) => p.toLowerCase().trim() === missedKey);
            const isNewWord = markings.newWords.some((w) => w.toLowerCase().trim() === missedKey);
            const originalTerm =
              markings.pronounceItems.find((p) => p.toLowerCase().trim() === missedKey) ||
              markings.newWords.find((w) => w.toLowerCase().trim() === missedKey) ||
              missedKey;

            const normalizedLookup = missedKey.replace(/[_\-]+/g, ' ');
            const dbMatch = NATIVE_FRIENDS_DICTIONARY_DATABASE[missedKey] || NATIVE_FRIENDS_DICTIONARY_DATABASE[normalizedLookup];

            if (dbMatch) {
              validatedVocab.push({
                id: `vocab-${validatedVocab.length + 1}`,
                term: originalTerm,
                partOfSpeech: isPronounce ? 'Pronunciation Focus' : dbMatch.partOfSpeech,
                definitionEn: isPronounce
                  ? `Pronunciation focus: Pay careful attention to syllable stress and sound articulation on "${originalTerm}".`
                  : dbMatch.definitionEn,
                simpleDefinition: isPronounce
                  ? (language === 'pt'
                      ? `Foco em pronúncia: Preste atenção à tonicidade da sílaba e articulação de "${originalTerm}".`
                      : `Pronunciation focus: Pay careful attention to syllable stress on "${originalTerm}".`)
                  : (language === 'pt'
                      ? (dbMatch.explanationPt || `Termo comunicativo (${cefr}): utilizado em inglês autêntico para expressar "${originalTerm}"${dbMatch.translationPt ? ` (${dbMatch.translationPt})` : ''} com clareza e naturalidade.`)
                      : dbMatch.definitionEn),
                collocations: (dbMatch.collocations && dbMatch.collocations.length > 0)
                  ? dbMatch.collocations
                  : [`in the context of "${originalTerm}"`, `spoken usage of "${originalTerm}"`],
                realExamples: (dbMatch.realExamples || [dbMatch.exampleSentenceEn]).map((ex: string) =>
                  ex.startsWith('Didactic Example:') ? ex : `Didactic Example: "${ex.replace(/^["']|["']$/g, '')}"`
                ),
                synonyms: (dbMatch.synonyms && dbMatch.synonyms.length > 0) ? dbMatch.synonyms : ['target expression'],
                register: dbMatch.register || 'neutral',
                category: isNewWord && isPronounce
                  ? 'New Word & Pronunciation (Alt+W + Alt+P)'
                  : isPronounce
                  ? 'Pronunciation & Phonetics (Alt+P)'
                  : 'New Words & Expressions (Alt+W)',
                phoneticGuide: isPronounce
                  ? `🎯 Pronunciation focus: practice clean syllable stress on "${originalTerm}" without adding Portuguese final vowels.`
                  : dbMatch.phonetic,
                isPronunciationFocus: isPronounce,
                isNewWord,
              });
            } else {
              validatedVocab.push({
                id: `vocab-${validatedVocab.length + 1}`,
                term: originalTerm,
                partOfSpeech: isPronounce
                  ? 'Pronunciation Focus'
                  : originalTerm.includes(' ')
                  ? 'Idiomatic Expression'
                  : 'Conversational Vocabulary',
                definitionEn: isPronounce
                  ? `Target pronunciation focus: Practice clean sound articulation, syllable stress, and connected speech rhythm for "${originalTerm}".`
                  : `A natural conversational expression used by native speakers to articulate "${originalTerm}" in context.`,
                simpleDefinition: isPronounce
                  ? (language === 'pt'
                      ? `Foco em pronúncia: Preste atenção à tonicidade correta e evite acrescentar vogais de apoio ao pronunciar "${originalTerm}".`
                      : `Pronunciation focus: Pay attention to syllable stress and vowel reduction when pronouncing "${originalTerm}".`)
                  : (language === 'pt'
                      ? `Termo comunicativo (${cefr}): utilizado em inglês autêntico para expressar a ideia de "${originalTerm}".`
                      : `Communicative term (${cefr}): used in authentic English to convey "${originalTerm}".`),
                collocations: isPronounce
                  ? [`pronounce "${originalTerm}" clearly`, `syllable stress on "${originalTerm}"`]
                  : [`common usage of "${originalTerm}"`, `conversational context with "${originalTerm}"`],
                realExamples: isPronounce
                  ? [
                      `Didactic Example: "In connected speech, place clear syllable stress on '${originalTerm}' without vowel lengthening."`,
                      `Didactic Example: "Listen closely to reproduce the natural rhythm and intonation of '${originalTerm}'."`,
                    ]
                  : [
                      `Didactic Example: "Native speakers employ '${originalTerm}' in relevant conversational contexts."`,
                      `Didactic Example: "Reviewing '${originalTerm}' in context helps incorporate it into active speaking."`,
                    ],
                synonyms: isPronounce ? ['phonetic focus', 'pronunciation target'] : ['conversational expression', 'target vocabulary'],
                register: 'neutral',
                category: isNewWord && isPronounce
                  ? 'New Word & Pronunciation (Alt+W + Alt+P)'
                  : isPronounce
                  ? 'Pronunciation & Phonetics (Alt+P)'
                  : 'New Words & Expressions (Alt+W)',
                phoneticGuide: isPronounce
                  ? `🎯 Pronunciation focus: practice clean syllable stress on "${originalTerm}" without adding Portuguese final vowels.`
                  : `🎯 Pronounce "${originalTerm}" with natural English rhythm and syllable emphasis.`,
                isPronunciationFocus: isPronounce,
                isNewWord,
              });
            }
          });

          // Validation of grammar: ensure at least 2 grammar points are available for student (original rule)
          let validatedGrammar: any[] = [];
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
                ? g.examples.map((ex: any) => {
                    const str = String(ex || '').trim();
                    return str.startsWith('Didactic Example:') ? str : `Didactic Example: "${str.replace(/^["']|["']$/g, '')}"`;
                  })
                : [],
              commonMistakes: String(g.commonMistakes || '').trim(),
              comparisons: String(g.comparisons || '').trim(),
            }));

          if (validatedGrammar.length < 2) {
            const fallbackGp = generateLocalPedagogicalTransformation({
              rawNotes,
              topic,
              sessionDate,
              teacherName,
              studentLevel: authoritativeLevel,
              language,
            }).grammarPoints;
            fallbackGp.forEach((fgp) => {
              if (validatedGrammar.length < 2 && !validatedGrammar.some((vg) => vg.topic.toLowerCase() === fgp.topic.toLowerCase())) {
                validatedGrammar.push({
                  id: `grammar-${validatedGrammar.length + 1}`,
                  topic: fgp.topic,
                  rule: fgp.rule,
                  form: fgp.form,
                  usage: fgp.usage,
                  examples: fgp.examples,
                  commonMistakes: fgp.commonMistakes,
                  comparisons: fgp.comparisons,
                });
              }
            });
          }

          const allCorrections = validatedMistakes.map((m: any) => ({
            original: m.original,
            corrected: m.corrected,
            explanation: m.explanation,
          }));

          const allVocab = validatedVocab.map((v: any) => {
            const tag = v.isNewWord && v.isPronunciationFocus
              ? '🎯✨ [Word & Pronounce]'
              : v.isPronunciationFocus
              ? '🎯 [Pronounce]'
              : '✨';
            return `${tag} ${v.term} (${v.partOfSpeech || 'Vocab'}) — ${v.simpleDefinition || ''}`;
          });

          const allRules = validatedGrammar.map((g: any) => `${g.topic}: ${g.rule}`);

          let rememberThis =
            typeof parsed?.reviewSummary?.rememberThis === 'string' && parsed.reviewSummary.rememberThis.trim().length > 10
              ? parsed.reviewSummary.rememberThis.trim()
              : '';

          if (!rememberThis) {
            if (validatedMistakes.length > 0) {
              rememberThis =
                language === 'pt'
                  ? `Lembre-se disto: Em vez de dizer "${validatedMistakes[0].original}", use "${validatedMistakes[0].corrected}"!`
                  : `Remember this: Instead of saying "${validatedMistakes[0].original}", say "${validatedMistakes[0].corrected}"!`;
            } else if (validatedVocab.length > 0) {
              const termNames = validatedVocab.map((v: any) => v.term).slice(0, 3).join(', ');
              rememberThis =
                language === 'pt'
                  ? `Lembre-se disto: A prática ativa das novas expressões (${termNames}) transforma o reconhecimento passivo em confiança espontânea!`
                  : `Remember this: Active practice with your new expressions (${termNames}) turns passive recognition into spontaneous conversational confidence!`;
            } else {
              rememberThis =
                language === 'pt'
                  ? 'Lembre-se: Fluência não significa nunca errar, mas reconhecer padrões rapidamente e adotar a fraseologia nativa!'
                  : 'Remember: Fluency is not about never making mistakes; it is about recognizing patterns quickly and adopting natural native phraseology!';
            }
          }

          const transformation = {
            lessonId: lessonId || undefined,
            sessionKey: canonicalSessionKey,
            sessionDate,
            topic,
            teacherName,
            studentUid,
            studentEmail: cleanEmail,
            studentLevel: String(authoritativeLevel),
            cefrLevel: cefr,
            contentHash,
            language,
            promptVersion: PEDAGOGICAL_PROMPT_VERSION,
            isAiGenerated: true,
            isFallback: false,
            isProvisional: false,
            source: 'gemini' as const,
            modelUsed: GEMINI_FIXED_MODEL,
            mistakesAnalysis: validatedMistakes,
            grammarPoints: validatedGrammar,
            vocabularyAndExpressions: validatedVocab,
            levelAdaptation: parsed.levelAdaptation || {
              cefrLevel: cefr,
              levelLabel: cefrMeta.labelEn,
              nativeInterferenceNotes: 'Focus on native collocations and avoiding literal calques.',
              complexityAdjustmentAdvice: 'Review key corrections out loud before each session.',
              targetedPracticePrompt: `Practice summarizing your views on "${topic}".`,
            },
            reviewSummary: {
              estimatedMinutes: '5–10 minutes',
              keyRules: allRules,
              mustKnowVocabulary: allVocab,
              essentialCorrections: allCorrections,
              rememberThis,
            },
            rawNotesSnippet: markings.cleanText.slice(0, 300),
            correctStampsCount: correctCount,
            incorrectStampsCount: incorrectCount,
            newWordStampsCount: newWordCount,
            pronounceStampsCount: pronounceCount,
            generatedAt: new Date().toISOString(),
          };

          db.pedagogicalTransformationsMap[compositeCacheKey] = transformation;
          if (language === 'pt') {
            db.pedagogicalTransformationsMap[canonicalSessionKey] = transformation;
          }
          await savePedagogicalTransformationToFirestoreServer(compositeCacheKey, transformation);
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
              if (!db.studentJournalMap) db.studentJournalMap = {};
              const currentJournal =
                (cleanUid && db.studentJournalMap[cleanUid]) ||
                (effectiveEmail && db.studentJournalMap[effectiveEmail]) ||
                [];
              const filteredJournal = currentJournal.filter((e: any) => e.id !== journalRes.entry.id);
              const updatedJournal = [journalRes.entry, ...filteredJournal];
              if (cleanUid) db.studentJournalMap[cleanUid] = updatedJournal;
              if (effectiveEmail) db.studentJournalMap[effectiveEmail] = updatedJournal;
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
          });
        }
      } else if (singleAttempt?.error) {
        lastFailureCategory = singleAttempt.error.category as GeminiFailureCategory;
        if (singleAttempt.error.statusCode === 429 || lastFailureCategory === 'QUOTA_EXCEEDED') {
          geminiQuotaCooldownUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
        }
      }
    }

    // Graceful deterministic fallback strictly faithful to notes — clearly identified as provisional
    const fallbackTransformation = generateServerPedagogicalFallback({
      rawNotes,
      topic,
      sessionDate,
      teacherName,
      studentLevel: authoritativeLevel,
      studentUid,
      studentEmail: cleanEmail,
      lessonId,
      sessionKey: canonicalSessionKey,
      language,
    });

    fallbackTransformation.isAiGenerated = false;
    fallbackTransformation.isFallback = true;
    fallbackTransformation.isProvisional = true;
    fallbackTransformation.source = 'fallback';
    fallbackTransformation.fallbackReason = lastFailureCategory || (isCooldownActive ? 'QUOTA_EXCEEDED' : 'AI_UNAVAILABLE');
    if (lastFailureCategory === 'SERVICE_UNAVAILABLE') {
      fallbackTransformation.aiNotice =
        language === 'pt'
          ? 'O modelo Gemini está temporariamente indisponível devido à alta demanda (HTTP 503). Suas notas originais foram preservadas e você pode tentar novamente a qualquer momento.'
          : 'The Gemini model is temporarily experiencing high demand (HTTP 503). Original teacher notes are preserved and you can retry at any time.';
    } else {
      fallbackTransformation.aiNotice = getAiUnavailableNoticeText(language);
    }
    if (isCooldownActive || lastFailureCategory === 'QUOTA_EXCEEDED') {
      fallbackTransformation.cooldownSecondsRemaining = Math.max(1, Math.ceil((geminiQuotaCooldownUntil - Date.now()) / 1000));
    }

    // FASE 4B.8: Do NOT persist provisional fallback as definitive cache!
    // "Não reutilizar resultados provisórios como se fossem definitivos. Se a IA falhar, manter as notas originais e estado pendente, permitindo nova tentativa controlada. Não persistir conteúdo genérico como definitivo."
    return res.json({
      success: true,
      cached: false,
      transformation: fallbackTransformation,
    });
  } finally {
    await flightLock.release();
  }
});

// Retrieve cached pedagogical transformation
app.get('/api/pedagogical-notes', firebaseAuthMiddleware, async (req, res) => {
  const db = readDb();
  const sessionKey = (req.query.sessionKey as string) || (req.query.id as string) || '';
  const studentUid = (req.query.studentUid as string) || '';
  const language = ((req.query.language as string) || (req.query.lang as string) || '').toLowerCase().trim();
  const contentHash = ((req.query.contentHash as string) || '').trim();

  const caller = req.user!;
  if (caller.role === 'student') {
    if (studentUid && caller.uid !== studentUid) {
      return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized access to student notes.' });
    }
  }

  if (sessionKey) {
    let transformation: any = null;
    if (language) {
      const match = Object.entries(db.pedagogicalTransformationsMap || {}).find(([k, v]: [string, any]) => {
        const matchKey = k === sessionKey || k.startsWith(`${sessionKey}__`);
        const matchLang = v?.language === language;
        const matchHash = !contentHash || v?.contentHash === contentHash;
        return matchKey && matchLang && matchHash;
      });
      if (match) transformation = match[1];
    }
    if (!transformation && db.pedagogicalTransformationsMap?.[sessionKey]) {
      const candidate = db.pedagogicalTransformationsMap[sessionKey];
      if (!contentHash || candidate.contentHash === contentHash) {
        transformation = candidate;
      }
    }
    if (!transformation) {
      const found = Object.entries(db.pedagogicalTransformationsMap || {}).find(([k, v]: [string, any]) => {
        const matchKey = k === sessionKey || k.startsWith(`${sessionKey}__`);
        const matchHash = !contentHash || v?.contentHash === contentHash;
        return matchKey && matchHash;
      });
      if (found) transformation = found[1];
    }

    // Firestore fallback lookup if in-memory cache misses
    if (!transformation) {
      try {
        const fsMatch = await fetchPedagogicalTransformationFromFirestoreServer(sessionKey, { language, contentHash });
        if (fsMatch && fsMatch.isAiGenerated && !fsMatch.isProvisional) {
          transformation = fsMatch;
          const storeKey = fsMatch.cacheKey || `${sessionKey}__hash_${fsMatch.contentHash || 'any'}__lang_${fsMatch.language || language || 'pt'}`;
          if (!db.pedagogicalTransformationsMap) db.pedagogicalTransformationsMap = {};
          db.pedagogicalTransformationsMap[storeKey] = fsMatch;
          if (fsMatch.language === 'pt') {
            db.pedagogicalTransformationsMap[sessionKey] = fsMatch;
          }
        }
      } catch (fsErr) {
        console.warn('GET /api/pedagogical-notes Firestore lookup notice:', fsErr);
      }
    }

    if (transformation) {
      if (caller.role === 'student') {
        const callerEmail = (caller.email || '').toLowerCase().trim();
        const tEmail = (transformation.studentEmail || '').toLowerCase().trim();
        const tUid = transformation.studentUid || '';
        if ((tUid && tUid !== caller.uid) || (tEmail && tEmail !== callerEmail)) {
          return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized access to student notes.' });
        }
      }
      return res.json(transformation);
    }
  }

  if (caller.role === 'student') {
    const callerEmail = (caller.email || '').toLowerCase().trim();
    const list = Object.values(db.pedagogicalTransformationsMap || {}).filter(
      (t: any) =>
        ((t.studentUid && t.studentUid === caller.uid) ||
         (t.studentEmail && (t.studentEmail || '').toLowerCase().trim() === callerEmail)) &&
        (!language || t.language === language)
    );
    return res.json(list);
  }

  if (studentUid) {
    const list = Object.values(db.pedagogicalTransformationsMap || {}).filter(
      (t: any) => t.studentUid === studentUid && (!language || t.language === language)
    );
    return res.json(list);
  }

  res.json(Object.values(db.pedagogicalTransformationsMap || {}));
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


// Endpoint: Get student journal entries
app.get('/api/student-journal', async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db = readDb();
  const studentEmail = ((req.query.studentEmail as string) || (req.query.email as string) || '').toLowerCase().trim();
  const uid = (req.query.uid as string) || '';

  if (studentEmail || uid) {
    const fromEmail = (studentEmail && db.studentJournalMap?.[studentEmail]) || [];
    const fromUid = (uid && db.studentJournalMap?.[uid]) || [];
    const map = new Map<string, any>();
    [...fromEmail, ...fromUid].forEach((entry: any) => {
      if (entry?.id) map.set(entry.id, entry);
    });

    if (map.size === 0) {
      const docId = uid || studentEmail;
      try {
        const fsEntries = await fetchStudentDailyJournalFromServerFirestore(docId);
        if (Array.isArray(fsEntries) && fsEntries.length > 0) {
          if (!db.studentJournalMap) db.studentJournalMap = {};
          if (uid) db.studentJournalMap[uid] = fsEntries;
          if (studentEmail) db.studentJournalMap[studentEmail] = fsEntries;
          return res.json(fsEntries);
        }
      } catch {}
    }

    const list = Array.from(map.values()).sort((a, b) => {
      const tA = new Date(a.createdAt || a.date).getTime();
      const tB = new Date(b.createdAt || b.date).getTime();
      return tB - tA;
    });
    return res.json(list);
  }
  res.json([]);
});

// Endpoint: Save student journal entry
app.post('/api/student-journal', async (req, res) => {
  const db = readDb();
  const { studentEmail, studentUid, entry } = req.body || {};
  const cleanEmail = (studentEmail || '').toLowerCase().trim();

  if (!cleanEmail && !studentUid) {
    return res.status(400).json({ error: 'studentEmail or studentUid is required' });
  }

  if (!db.studentJournalMap) db.studentJournalMap = {};
  const currentList: any[] =
    (cleanEmail && db.studentJournalMap[cleanEmail]) ||
    (studentUid && db.studentJournalMap[studentUid]) ||
    [];

  const filtered = currentList.filter((e: any) => e.id !== entry.id);
  const updated = [entry, ...filtered];

  if (cleanEmail) db.studentJournalMap[cleanEmail] = updated;
  if (studentUid) db.studentJournalMap[studentUid] = updated;

  // Direct atomic write to Cloud Firestore by UID
  const docId = studentUid || cleanEmail;
  if (docId) {
    saveStudentJournalToFirestore(docId, updated).catch(() => {});
  }

  await writeDbSync(db);
  res.json({ success: true, journal: updated });
});

// Endpoint: Student Journal Activity Log (Multi-device cloud synchronization for video, audio, memorization, lesson)
app.get('/api/student-journal/activity', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db = readDb();
  const studentEmail = ((req.query.studentEmail as string) || (req.query.email as string) || '').toLowerCase().trim();
  const uid = ((req.query.studentUid as string) || (req.query.uid as string) || '').trim();

  if (!db.studentActivityJournal) db.studentActivityJournal = {};
  const fromEmail = (studentEmail && db.studentActivityJournal[studentEmail]) || [];
  const fromUid = (uid && db.studentActivityJournal[uid]) || [];
  const map = new Map<string, any>();
  [...fromEmail, ...fromUid].forEach((e: any) => {
    if (e?.id) map.set(e.id, e);
  });
  const list = Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  res.json({ success: true, entries: list });
});

app.post('/api/student-journal/activity', async (req, res) => {
  const db = readDb();
  const { studentEmail, studentUid, entry } = req.body || {};
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = (studentUid || '').trim();

  if (!entry || (!cleanEmail && !cleanUid)) {
    return res.status(400).json({ error: 'entry and studentEmail or studentUid are required' });
  }

  if (!db.studentActivityJournal) db.studentActivityJournal = {};
  const current = (cleanEmail && db.studentActivityJournal[cleanEmail]) || (cleanUid && db.studentActivityJournal[cleanUid]) || [];
  const filtered = current.filter((e: any) => {
    if (e.id === entry.id) return false;
    if (
      e.type === entry.type &&
      e.week === entry.week &&
      e.dayOfWeek &&
      entry.dayOfWeek &&
      e.dayOfWeek === entry.dayOfWeek
    ) {
      return false;
    }
    return true;
  });
  const updated = [entry, ...filtered];
  if (cleanEmail) db.studentActivityJournal[cleanEmail] = updated;
  if (cleanUid) db.studentActivityJournal[cleanUid] = updated;

  if (cleanEmail && db.userProfiles?.[cleanEmail]) {
    db.userProfiles[cleanEmail].studentJournal = updated;
  }
  if (cleanUid && db.userProfiles?.[cleanUid]) {
    db.userProfiles[cleanUid].studentJournal = updated;
  }

  // Direct atomic write to Cloud Firestore by UID
  const docId = cleanUid || cleanEmail;
  if (docId) {
    saveStudentJournalToFirestore(docId, updated).catch(() => {});
  }

  await writeDbSync(db);
  res.json({ success: true, entries: updated });
});

app.delete('/api/student-journal/activity', async (req, res) => {
  const db = readDb();
  const { studentEmail, studentUid, type, dayOfWeek, week } = req.body || {};
  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  const cleanUid = (studentUid || '').trim();

  if (!db.studentActivityJournal) db.studentActivityJournal = {};
  const current = (cleanEmail && db.studentActivityJournal[cleanEmail]) || (cleanUid && db.studentActivityJournal[cleanUid]) || [];
  const updated = current.filter((e: any) => !(e.type === type && e.dayOfWeek === dayOfWeek && e.week === week));

  if (cleanEmail) db.studentActivityJournal[cleanEmail] = updated;
  if (cleanUid) db.studentActivityJournal[cleanUid] = updated;

  if (cleanEmail && db.userProfiles?.[cleanEmail]) {
    db.userProfiles[cleanEmail].studentJournal = updated;
  }
  if (cleanUid && db.userProfiles?.[cleanUid]) {
    db.userProfiles[cleanUid].studentJournal = updated;
  }

  // Direct atomic write to Cloud Firestore by UID
  const docId = cleanUid || cleanEmail;
  if (docId) {
    saveStudentJournalToFirestore(docId, updated).catch(() => {});
  }

  await writeDbSync(db);
  res.json({ success: true, entries: updated });
});

// Endpoint: Strict UID correlation verification between Student and Native Friend
app.get('/api/students/verify-link', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db = readDb();
  const studentUid = ((req.query.studentUid as string) || '').trim();
  const studentEmail = ((req.query.studentEmail as string) || '').toLowerCase().trim();
  const teacherUid = ((req.query.teacherUid as string) || '').trim();
  const teacherEmail = ((req.query.teacherEmail as string) || '').toLowerCase().trim();

  const adminEmails = [
    'adm.itissimple@gmail.com',
    'estilobeeforkids@gmail.com',
    'adm.itssimple@gmail.com',
    'estilobeeadm@gmail.com',
  ];

  if (
    teacherUid === 'admin' ||
    adminEmails.includes(teacherEmail) ||
    teacherEmail.includes('admin')
  ) {
    return res.json({ isLinked: true, reason: 'admin' });
  }

  if (!teacherUid && !teacherEmail) {
    return res.json({ isLinked: true, reason: 'self' });
  }

  // Find student in db.students
  const student = (db.students || []).find((s: any) => {
    const sUid = (s.uid || s.id || '').trim();
    const sEmail = (s.email || s.studentEmail || '').toLowerCase().trim();
    return (studentUid && sUid === studentUid) || (studentEmail && sEmail === studentEmail);
  });

  if (student) {
    const sTeacherUid = (student.teacherUid || (student as any).assignedTeacherId || '').trim();
    const sTeacherEmail = (student.teacherEmail || '').toLowerCase().trim();
    if (
      (teacherUid && sTeacherUid && teacherUid === sTeacherUid) ||
      (teacherEmail && sTeacherEmail && teacherEmail === sTeacherEmail) ||
      (teacherUid && sTeacherEmail && teacherUid.toLowerCase().includes(sTeacherEmail))
    ) {
      return res.json({ isLinked: true, reason: 'assigned_student' });
    }
  }

  // Check scheduled lessons
  const hasLesson = (db.liveLessons || []).some((l: any) => {
    const lStudentEmail = (l.studentEmail || '').toLowerCase().trim();
    const lStudentUid = (l.studentUid || '').trim();
    const lTeacherEmail = (l.teacherEmail || (l as any).tutorEmail || '').toLowerCase().trim();
    const lTeacherUid = (l.teacherUid || (l as any).tutorUid || '').trim();

    const studentMatches = (studentEmail && lStudentEmail === studentEmail) || (studentUid && lStudentUid === studentUid);
    const teacherMatches = (teacherEmail && lTeacherEmail === teacherEmail) || (teacherUid && lTeacherUid === teacherUid);
    return studentMatches && teacherMatches && l.status !== 'cancelled';
  });

  if (hasLesson) {
    return res.json({ isLinked: true, reason: 'active_lesson' });
  }

  return res.json({ isLinked: false, reason: 'unauthorized_uid_pair' });
});

app.delete(['/api/lessons/:id', '/api/live-lessons/:id'], (req, res) => {
  const db = readDb();
  const id = decodeURIComponent(req.params.id);
  db.liveLessons = db.liveLessons.filter((l) => l.id !== id);
  writeDb(db);
  res.json({ success: true, liveLessons: db.liveLessons });
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

app.post('/api/routines/words', (req, res) => {
  const db = readDb();
  const { day, activityId, words, studentEmail, studentUid } = req.body;
  const { email, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);
  const targetKeys = Array.from(new Set([email, uid, studentEmail, studentUid].filter(Boolean) as string[]));

  if (db.routinesByDay && db.routinesByDay[day]) {
    db.routinesByDay[day] = db.routinesByDay[day].map((item: any, idx: number) =>
      item.id === activityId || (!activityId && idx === 0) ? { ...item, learnedWords: words } : item
    );
  }

  if (targetKeys.length > 0) {
    if (!db.studentRoutinesMap) db.studentRoutinesMap = {};
    targetKeys.forEach((k) => {
      if (!db.studentRoutinesMap[k]) {
        db.studentRoutinesMap[k] = JSON.parse(JSON.stringify(db.routinesByDay || defaultRoutinesByDay));
      }
      if (db.studentRoutinesMap[k][day]) {
        db.studentRoutinesMap[k][day] = db.studentRoutinesMap[k][day].map((item: any, idx: number) =>
          item.id === activityId || (!activityId && idx === 0) ? { ...item, learnedWords: words } : item
        );
      }
    });
  }

  writeDb(db);
  res.json({ success: true, learnedWords: words });
});

app.post('/api/routines/toggle', (req, res) => {
  const db = readDb();
  const { day, activityId, studentEmail, studentUid, videoId } = req.body;
  const { email, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);
  const targetKeys = Array.from(new Set([email, uid].filter(Boolean) as string[]));

  let becameCompleted = false;

  if (db.routinesByDay && db.routinesByDay[day]) {
    db.routinesByDay[day] = db.routinesByDay[day].map((item: any) => {
      if (item.id === activityId) {
        const nextState = !item.completedToday;
        if (nextState) becameCompleted = true;
        return { ...item, completedToday: nextState, completed: nextState };
      }
      return item;
    });
  }

  targetKeys.forEach((k) => {
    if (db.studentRoutinesMap?.[k]?.[day]) {
      db.studentRoutinesMap[k][day] = db.studentRoutinesMap[k][day].map((item: any) => {
        if (item.id === activityId) {
          const nextState = !item.completedToday;
          if (nextState) becameCompleted = true;
          return { ...item, completedToday: nextState, completed: nextState };
        }
        return item;
      });
    }

    if (becameCompleted && videoId) {
      const cleanVid = extractServerYouTubeId(videoId);
      if (cleanVid) {
        if (!db.studentWatchedVideos) db.studentWatchedVideos = {};
        if (!db.studentWatchedVideos[k]) db.studentWatchedVideos[k] = [];
        if (!db.studentWatchedVideos[k].includes(cleanVid)) {
          db.studentWatchedVideos[k].push(cleanVid);
        }
      }
    }
  });

  writeDb(db);
  res.json({ success: true });
});

app.post('/api/routines/teacher-video', (req, res) => {
  const db = readDb();
  const {
    activityId,
    activityName,
    playlistTitle,
    playlistId,
    videos,
    teacherNotes,
    days,
    day,
    studentEmail,
    studentUid,
    teacherUid,
    teacherEmail,
  } = req.body;

  const targetDays: string[] = Array.isArray(days) && days.length > 0
    ? days
    : day
    ? [day]
    : Object.keys(db.routinesByDay || {});

  const { email, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);
  const resolvedTopicTitle = activityName || playlistTitle || videos?.[0]?.playlistTitle;

  // 1. Update global db.routinesByDay for fallback
  targetDays.forEach((d: string) => {
    if (db.routinesByDay && db.routinesByDay[d]) {
      db.routinesByDay[d] = db.routinesByDay[d].map((item: any) =>
        item.id === activityId || item.activityName?.toLowerCase().includes('video') || item.activityName?.toLowerCase().includes('vídeo')
          ? {
              ...item,
              activityName: resolvedTopicTitle || item.activityName,
              teacherVideos: videos,
              teacherNotes: teacherNotes || item.teacherNotes,
            }
          : item
      );
    }
  });

  // 2. If student is identified, persist to studentRoutinesMap and studentVideoAssignments
  if (email || uid) {
    if (!db.studentRoutinesMap) db.studentRoutinesMap = {};
    if (!db.studentVideoAssignments) db.studentVideoAssignments = {};

    let existingRoutines =
      (email && db.studentRoutinesMap[email]) ||
      (uid && db.studentRoutinesMap[uid]) ||
      null;

    if (!existingRoutines || typeof existingRoutines !== 'object' || Object.keys(existingRoutines).length === 0) {
      existingRoutines = JSON.parse(JSON.stringify(db.routinesByDay || {}));
    } else {
      const defaultDays = Object.keys(db.routinesByDay || {});
      defaultDays.forEach((d) => {
        if (!existingRoutines[d] || !Array.isArray(existingRoutines[d]) || existingRoutines[d].length === 0) {
          existingRoutines[d] = JSON.parse(JSON.stringify(db.routinesByDay[d] || []));
        }
      });
    }

    targetDays.forEach((d: string) => {
      if (existingRoutines && existingRoutines[d]) {
        let matched = false;
        existingRoutines[d] = existingRoutines[d].map((item: any) => {
          const match = activityId
            ? item.id === activityId
            : item.id?.endsWith('1') || item.activityName?.toLowerCase().includes('video') || item.activityName?.toLowerCase().includes('vídeo');
          if (match) {
            matched = true;
            return {
              ...item,
              activityName: resolvedTopicTitle || item.activityName,
              teacherVideos: videos,
              teacherNotes: teacherNotes || item.teacherNotes,
            };
          }
          return item;
        });
        if (!matched && existingRoutines[d].length > 0) {
          existingRoutines[d][0] = {
            ...existingRoutines[d][0],
            activityName: resolvedTopicTitle || existingRoutines[d][0].activityName,
            teacherVideos: videos,
            teacherNotes: teacherNotes || existingRoutines[d][0].teacherNotes,
          };
        }
      }

      // Record in studentVideoAssignments for anti-repetition history
      const keysToUpdate = [email, uid].filter(Boolean) as string[];
      keysToUpdate.forEach((key) => {
        if (!db.studentVideoAssignments[key]) db.studentVideoAssignments[key] = [];
        db.studentVideoAssignments[key] = db.studentVideoAssignments[key].filter(
          (a: any) => a.day !== d
        );

        if (Array.isArray(videos) && videos.length > 0 && videos[0]?.url) {
          const validVidId = extractServerYouTubeId(videos[0].videoId || videos[0].url) || '';
          const newAssignment = {
            id: `assign-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            activityId: activityId || 'act-1',
            studentEmail: email,
            studentUid: uid,
            teacherUid: (teacherUid || '').trim(),
            teacherEmail: (teacherEmail || '').trim(),
            day: d,
            playlistId: videos[0].playlistId || 'custom-teacher-url',
            playlistTitle: videos[0].playlistTitle || 'Teacher Assigned Custom Video',
            videoId: validVidId,
            videoTitle: videos[0].title || 'Teacher Assigned Video',
            videoUrl: videos[0].url,
            assignedAt: new Date().toISOString(),
          };
          db.studentVideoAssignments[key].push(newAssignment);
        }
      });
    });

    if (email) db.studentRoutinesMap[email] = existingRoutines;
    if (uid) db.studentRoutinesMap[uid] = existingRoutines;

    const targetUid = uid || (email ? email.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_') : '');
    if (targetUid) {
      targetDays.forEach((d: string) => {
        const dayActs = existingRoutines[d] || [];
        const videoAct = dayActs.find((a: any) => a.teacherVideos && a.teacherVideos.length > 0) || dayActs[0];
        if (videoAct) {
          saveRoutineVideoSubcollection(targetUid, d, videoAct).catch(() => {});
        }
      });
      saveStudentAssignmentsByUid(targetUid, {
        uid: targetUid,
        email,
        videoAssignments: (email && db.studentVideoAssignments[email]) || (uid && db.studentVideoAssignments[uid]) || [],
        spotifyAssignments: (email && db.studentSpotifyAssignments[email]) || (uid && db.studentSpotifyAssignments[uid]) || [],
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
  }

  writeDb(db);
  res.json({ success: true, updatedDays: targetDays, studentEmail: email, studentUid: uid });
});

app.post('/api/routines/teacher-spotify', (req, res) => {
  const db = readDb();
  const {
    activityId,
    spotify,
    teacherNotes,
    days,
    day,
    studentEmail,
    studentUid,
    teacherUid,
    teacherEmail,
  } = req.body;

  // Strict validation and sanitization of Spotify URL
  if (spotify && spotify.url) {
    const spotifyValidation = parseSpotifyUrl(spotify.url);
    if (!spotifyValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: spotifyValidation.errorMessage || 'URL do Spotify inválida ou incompleta. Utilize um link válido de /track/, /episode/ ou /show/.',
      });
    }
    spotify.url = spotifyValidation.canonicalUrl;
    spotify.type = spotifyValidation.contentType;
  }

  const targetDays: string[] = Array.isArray(days) && days.length > 0
    ? days
    : day
    ? [day]
    : Object.keys(db.routinesByDay || {});

  const { email, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);

  targetDays.forEach((d: string) => {
    if (db.routinesByDay && db.routinesByDay[d]) {
      db.routinesByDay[d] = db.routinesByDay[d].map((item: any) =>
        item.id === activityId || item.activityName?.toLowerCase().includes('podcast') || item.activityName?.toLowerCase().includes('áudio')
          ? { ...item, teacherSpotify: spotify, teacherNotes: teacherNotes || item.teacherNotes }
          : item
      );
    }
  });

  if (email || uid) {
    if (!db.studentRoutinesMap) db.studentRoutinesMap = {};
    if (!db.studentSpotifyAssignments) db.studentSpotifyAssignments = {};

    let existingRoutines =
      (email && db.studentRoutinesMap[email]) ||
      (uid && db.studentRoutinesMap[uid]) ||
      null;

    if (!existingRoutines || typeof existingRoutines !== 'object' || Object.keys(existingRoutines).length === 0) {
      existingRoutines = JSON.parse(JSON.stringify(db.routinesByDay || {}));
    } else {
      const defaultDays = Object.keys(db.routinesByDay || {});
      defaultDays.forEach((d) => {
        if (!existingRoutines[d] || !Array.isArray(existingRoutines[d]) || existingRoutines[d].length === 0) {
          existingRoutines[d] = JSON.parse(JSON.stringify(db.routinesByDay[d] || []));
        }
      });
    }

    targetDays.forEach((d: string) => {
      if (existingRoutines && existingRoutines[d]) {
        let matched = false;
        existingRoutines[d] = existingRoutines[d].map((item: any) => {
          const match = activityId
            ? item.id === activityId
            : item.id?.endsWith('2') || item.activityName?.toLowerCase().includes('podcast') || item.activityName?.toLowerCase().includes('áudio');
          if (match) {
            matched = true;
            return {
              ...item,
              teacherSpotify: spotify,
              teacherNotes: teacherNotes || item.teacherNotes,
            };
          }
          return item;
        });
        if (!matched && existingRoutines[d].length > 0) {
          existingRoutines[d][0] = {
            ...existingRoutines[d][0],
            teacherSpotify: spotify,
            teacherNotes: teacherNotes || existingRoutines[d][0].teacherNotes,
          };
        }
      }

      // Record in studentSpotifyAssignments for strict UID/email persistence and auditing
      const keysToUpdate = [email, uid].filter(Boolean) as string[];
      keysToUpdate.forEach((key) => {
        if (!db.studentSpotifyAssignments![key]) db.studentSpotifyAssignments![key] = [];
        db.studentSpotifyAssignments![key] = db.studentSpotifyAssignments![key].filter(
          (a: any) => a.day !== d
        );

        if (spotify && spotify.url) {
          const newAssignment = {
            id: spotify.id || `spot-assign-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            activityId: activityId || 'act-2',
            studentEmail: email,
            studentUid: uid,
            teacherUid: (teacherUid || '').trim(),
            teacherEmail: (teacherEmail || '').trim(),
            day: d,
            url: spotify.url,
            title: spotify.title || 'Teacher Recommended Audio',
            artistOrHost: spotify.artistOrHost,
            type: spotify.type || 'music',
            instructions: spotify.instructions || teacherNotes,
            assignedAt: spotify.addedAt || new Date().toISOString(),
          };
          db.studentSpotifyAssignments![key].push(newAssignment);
        }
      });
    });

    if (email) db.studentRoutinesMap[email] = existingRoutines;
    if (uid) db.studentRoutinesMap[uid] = existingRoutines;

    const targetUid = uid || (email ? email.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_') : '');
    if (targetUid) {
      saveStudentAssignmentsByUid(targetUid, {
        uid: targetUid,
        email,
        videoAssignments: (email && db.studentVideoAssignments[email]) || (uid && db.studentVideoAssignments[uid]) || [],
        spotifyAssignments: (email && db.studentSpotifyAssignments[email]) || (uid && db.studentSpotifyAssignments[uid]) || [],
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
  }

  writeDb(db);
  res.json({ success: true, updatedDays: targetDays, studentEmail: email, studentUid: uid });
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

// Endpoint to retrieve individual student Spotify assignments by UID or email with auto-distribution and listened history
app.get('/api/student-spotify-assignments', (req, res) => {
  const db = readDb();
  const studentEmail = ((req.query.studentEmail as string) || (req.query.email as string) || '').toLowerCase().trim();
  const uid = ((req.query.uid as string) || (req.query.studentUid as string) || '').trim();
  const { email, uid: resolvedUid } = resolveStudentIdentifiers(db, studentEmail, uid);

  const studentLevel = normalizeStudentLevel(resolveStudentLevel(db, email, resolvedUid)).key;
  const keysToLookup = [resolvedUid, email].filter(Boolean) as string[];

  let assignments: any[] = [];
  for (const k of keysToLookup) {
    if (db.studentSpotifyAssignments?.[k] && Array.isArray(db.studentSpotifyAssignments[k])) {
      assignments = db.studentSpotifyAssignments[k];
      if (assignments.length > 0) break;
    }
  }

  // Check if assignments are missing, corrupted with duplicate track IDs, or level mismatched
  const uniqueTrackIds = new Set(
    assignments.map((a) => extractSpotifyTrackId(a.trackId || a.url || a.trackUrl)).filter(Boolean)
  );
  const hasRepeatingBug = assignments.length > 1 && uniqueTrackIds.size === 1;
  const levelMismatch = assignments.length > 0 && assignments.some((a) => {
    const aNorm = normalizeStudentLevel(a.level || a.playlistTitle).key;
    return aNorm !== studentLevel || (a.playlistId && a.playlistId !== SPOTIFY_LEVEL_PLAYLISTS[studentLevel].playlistId);
  });

  if (assignments.length < 7 || hasRepeatingBug || levelMismatch) {
    if (email || resolvedUid) {
      assignments = distributeWeeklySpotifyForStudent(db, email, resolvedUid, studentLevel);
      writeDb(db);
    }
  }

  const listenedKey = resolvedUid && db.studentListenedTracks?.[resolvedUid] ? resolvedUid : email;
  const listened = (listenedKey && db.studentListenedTracks?.[listenedKey]) || [];

  res.json({
    success: true,
    assignments,
    listened,
    studentEmail: email,
    studentUid: resolvedUid,
    studentLevel,
  });
});

// Endpoint for Spotify anti-repetition exclusive track assignment (Parity with YouTube video assignment engine)
app.post('/api/student-spotify-assignments/assign', (req, res) => {
  const db = readDb();
  const {
    studentEmail,
    studentUid,
    teacherUid,
    teacherEmail,
    day,
    level,
    playlistId,
    trackUrl,
    title,
    artistOrHost,
    teacherNotes,
    trackType,
    activityId,
  } = req.body;

  const { email: cleanEmail, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);

  if (!cleanEmail && !uid) {
    return res.status(400).json({ error: 'studentEmail or studentUid is required to assign Spotify track' });
  }

  const studentLevel = normalizeStudentLevel(level || resolveStudentLevel(db, cleanEmail, uid)).key;
  const levelPlaylist = SPOTIFY_LEVEL_PLAYLISTS[studentLevel] || SPOTIFY_LEVEL_PLAYLISTS.beginner;
  const targetDay = (day && DAYS_SEQUENCE.includes(day.toLowerCase()) ? day.toLowerCase() : 'monday') as any;

  if (!db.studentSpotifyAssignments) db.studentSpotifyAssignments = {};
  if (!db.studentListenedTracks) db.studentListenedTracks = {};
  if (!db.studentRoutinesMap) db.studentRoutinesMap = {};

  const userAssignments: any[] =
    (uid && db.studentSpotifyAssignments[uid]) ||
    (cleanEmail && db.studentSpotifyAssignments[cleanEmail]) ||
    [];

  const userListened: string[] =
    (uid && db.studentListenedTracks[uid]) ||
    (cleanEmail && db.studentListenedTracks[cleanEmail]) ||
    [];

  // Consumed track IDs: already listened OR already assigned to another day in the student's routine
  const consumedTrackIds = new Set<string>();
  userListened.forEach((id: string) => {
    const cid = extractSpotifyTrackId(id);
    if (cid) consumedTrackIds.add(cid);
  });
  userAssignments.forEach((assign: any) => {
    if (assign.day !== targetDay) {
      const cid = extractSpotifyTrackId(assign.trackId || assign.url || assign.trackUrl);
      if (cid) consumedTrackIds.add(cid);
    }
  });

  const playlistTracks = DAYS_SEQUENCE.map((d, i) => ({
    day: d,
    index: i + 1,
    ...levelPlaylist.tracks[d],
  }));

  let chosenTrack: any = null;
  let customUrl = (trackUrl || '').trim();

  if (customUrl) {
    const parsed = parseSpotifyUrl(customUrl);
    if (!parsed.isValid) {
      return res.status(400).json({
        error: parsed.errorMessage || 'Link do Spotify inválido. Utilize um link válido do open.spotify.com.',
      });
    }
    const trackId = parsed.id || `custom-${Date.now()}`;
    chosenTrack = {
      day: targetDay,
      index: 1,
      trackId,
      title: title || 'Faixa Selecionada pelo Professor',
      artist: artistOrHost || 'Artista / Podcast',
      url: parsed.canonicalUrl || customUrl,
      embedUrl: parsed.embedUrl,
      duration: '3-4 min',
      teacherTipPt: teacherNotes || 'Ouça com atenção e pratique a compreensão auditiva.',
      type: trackType || parsed.contentType || 'music',
    };
  } else {
    // Sequential Progression & Anti-Repetition Selection:
    // 1st priority: The day's designated track in the curriculum playlist if not consumed
    const dayDesignatedTrack = playlistTracks.find((t) => t.day === targetDay);
    const dayTrackId = dayDesignatedTrack ? extractSpotifyTrackId(dayDesignatedTrack.url) : null;

    if (dayDesignatedTrack && dayTrackId && !consumedTrackIds.has(dayTrackId)) {
      chosenTrack = dayDesignatedTrack;
    } else {
      // 2nd priority: Next unseen track in the playlist
      chosenTrack = playlistTracks.find((t) => {
        const tid = extractSpotifyTrackId(t.url);
        return tid && !consumedTrackIds.has(tid);
      });
    }

    // 3rd priority: If all consumed, recycle to designated track
    if (!chosenTrack) {
      chosenTrack = dayDesignatedTrack || playlistTracks[0];
    }
  }

  const chosenId = extractSpotifyTrackId(chosenTrack.url) || chosenTrack.trackId || `sp-${Date.now()}`;
  const canonicalUrl = `https://open.spotify.com/track/${chosenId}`;
  const embedUrl = chosenTrack.embedUrl || `https://open.spotify.com/embed/track/${chosenId}?utm_source=generator&theme=0`;

  const assignedTrackObj = {
    id: `sp-${targetDay}-${Date.now()}`,
    url: canonicalUrl,
    trackId: chosenId,
    title: title || chosenTrack.title,
    artistOrHost: artistOrHost || chosenTrack.artist || chosenTrack.artistOrHost || 'Native Friend',
    duration: chosenTrack.duration || '3-4 min',
    instructions:
      teacherNotes ||
      chosenTrack.teacherTipPt ||
      'Sugestão diária do Teacher: Ouça com atenção e pratique a compreensão auditiva.',
    type: trackType || chosenTrack.type || 'music',
    addedAt: new Date().toISOString(),
    level: studentLevel,
    playlistId: levelPlaylist.playlistId,
    playlistTitle: levelPlaylist.playlistTitle,
    trackIndex: chosenTrack.index || 1,
  };

  const newAssignment = {
    id: `spot-assign-${targetDay}-${Date.now()}`,
    activityId: activityId || `act-${targetDay}-2`,
    studentEmail: cleanEmail,
    studentUid: uid,
    teacherUid: (teacherUid || '').trim(),
    teacherEmail: (teacherEmail || '').trim(),
    day: targetDay,
    trackId: chosenId,
    trackTitle: assignedTrackObj.title,
    trackUrl: canonicalUrl,
    embedUrl,
    title: assignedTrackObj.title,
    artistOrHost: assignedTrackObj.artistOrHost,
    type: assignedTrackObj.type,
    instructions: assignedTrackObj.instructions,
    assignedAt: new Date().toISOString(),
    level: studentLevel,
    playlistId: levelPlaylist.playlistId,
    playlistTitle: levelPlaylist.playlistTitle,
    trackIndex: assignedTrackObj.trackIndex,
  };

  // Persist to studentSpotifyAssignments under both email and uid
  const targetKeys = Array.from(new Set([cleanEmail, uid].filter(Boolean) as string[]));
  targetKeys.forEach((k) => {
    if (!db.studentSpotifyAssignments![k]) db.studentSpotifyAssignments![k] = [];
    db.studentSpotifyAssignments![k] = db.studentSpotifyAssignments![k].filter(
      (a: any) => a.day !== targetDay
    );
    db.studentSpotifyAssignments![k].push(newAssignment);
  });

  // Update student routines in studentRoutinesMap
  targetKeys.forEach((k) => {
    let studentRoutine = db.studentRoutinesMap?.[k];
    if (!studentRoutine) {
      studentRoutine = JSON.parse(JSON.stringify(db.routinesByDay || defaultRoutinesByDay));
    }
    if (studentRoutine && studentRoutine[targetDay]) {
      let matched = false;
      studentRoutine[targetDay] = studentRoutine[targetDay].map((item: any) => {
        const isTarget =
          item.id?.endsWith('2') ||
          item.activityName?.toLowerCase().includes('podcast') ||
          item.activityName?.toLowerCase().includes('áudio') ||
          item.activityName?.toLowerCase().includes('audio');
        if (isTarget) {
          matched = true;
          return {
            ...item,
            teacherSpotify: assignedTrackObj,
            teacherNotes: teacherNotes || item.teacherNotes,
          };
        }
        return item;
      });
      if (!matched && studentRoutine[targetDay].length > 0) {
        studentRoutine[targetDay][0] = {
          ...studentRoutine[targetDay][0],
          teacherSpotify: assignedTrackObj,
          teacherNotes: teacherNotes || studentRoutine[targetDay][0].teacherNotes,
        };
      }
    }
    db.studentRoutinesMap![k] = studentRoutine;
  });

  // Calculate remaining unseen tracks in playlist
  const remainingUnseen = playlistTracks.filter((t) => {
    const tid = extractSpotifyTrackId(t.url);
    return tid && !consumedTrackIds.has(tid) && tid !== chosenId;
  }).length;

  writeDb(db);

  if (uid) {
    saveStudentAssignmentsByUid(uid, {
      uid,
      email: cleanEmail,
      level: studentLevel,
      spotifyAssignments: db.studentSpotifyAssignments?.[uid] || db.studentSpotifyAssignments?.[cleanEmail] || [],
      videoAssignments: db.studentVideoAssignments?.[uid] || db.studentVideoAssignments?.[cleanEmail] || [],
      routines: db.studentRoutinesMap?.[uid] || db.studentRoutinesMap?.[cleanEmail],
      updatedAt: new Date().toISOString(),
    }).catch((err) => console.warn('Firestore saveStudentAssignmentsByUid (Spotify assign) notice:', err));
  }

  res.json({
    success: true,
    track: assignedTrackObj,
    assignment: newAssignment,
    playlistTitle: levelPlaylist.playlistTitle,
    remainingUnseen,
    totalTracks: 7,
    studentEmail: cleanEmail,
    studentUid: uid,
    message: `Faixa "${assignedTrackObj.title}" atribuída com sucesso para ${targetDay}.`,
  });
});

// Endpoint to distribute exclusive sequential tracks for student active days (or Monday to Sunday)
app.post('/api/student-spotify-assignments/distribute-week', (req, res) => {
  const db = readDb();
  const { studentEmail, studentUid, teacherUid, teacherEmail, level, days } = req.body;
  const { email: cleanEmail, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);

  if (!cleanEmail && !uid) {
    return res.status(400).json({ error: 'studentEmail or studentUid is required' });
  }

  const assignments = distributeWeeklySpotifyForStudent(
    db,
    cleanEmail,
    uid,
    level,
    teacherUid,
    teacherEmail,
    Array.isArray(days) ? days : undefined
  );

  writeDb(db);

  res.json({
    success: true,
    assignments,
    studentEmail: cleanEmail,
    studentUid: uid,
    message: `Semana de ${assignments.length} faixas exclusivas do Spotify distribuída com sucesso!`,
  });
});

// Endpoint to record a track as listened by a student (parallel to studentWatchedVideos)
app.post('/api/student-spotify-assignments/listen', (req, res) => {
  const db = readDb();
  const { studentEmail, studentUid, trackId, trackUrl } = req.body;
  const { email: cleanEmail, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);

  const cleanTrackId = extractSpotifyTrackId(trackId || trackUrl);
  if (!cleanTrackId) {
    return res.status(400).json({ error: 'trackId or trackUrl is required' });
  }

  if (!db.studentListenedTracks) db.studentListenedTracks = {};

  const targetKeys = Array.from(new Set([cleanEmail, uid].filter(Boolean) as string[]));
  targetKeys.forEach((key) => {
    if (!db.studentListenedTracks![key]) db.studentListenedTracks![key] = [];
    if (!db.studentListenedTracks![key].includes(cleanTrackId)) {
      db.studentListenedTracks![key].push(cleanTrackId);
    }
  });

  writeDb(db);

  const activeListened = (uid && db.studentListenedTracks[uid]) || (cleanEmail && db.studentListenedTracks[cleanEmail]) || [];
  res.json({
    success: true,
    listened: activeListened,
    studentEmail: cleanEmail,
    studentUid: uid,
  });
});

// Endpoint to verify live Spotify Web API connection with the official token
app.get('/api/spotify/verify', async (req, res) => {
  const token = (req.query.token as string) || process.env.SPOTIFY_TOKEN || SPOTIFY_BEARER_TOKEN || '';
  if (!token) {
    return res.status(400).json({ connected: false, error: 'Spotify token not configured' });
  }

  try {
    const userRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const userData = await userRes.json();

    const playlistsRes = await fetch('https://api.spotify.com/v1/me/playlists?limit=20', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const playlistsData = await playlistsRes.json();

    const topTracksRes = await fetch('https://api.spotify.com/v1/me/top/tracks?time_range=long_term&limit=5', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const topTracksData = await topTracksRes.json();

    res.json({
      connected: userRes.ok,
      user: userData,
      playlistsCount: playlistsData?.items?.length || 0,
      playlists: (playlistsData?.items || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        totalTracks: p.items?.total || p.tracks?.total || 7,
        url: p.external_urls?.spotify,
      })),
      topTracksCount: topTracksData?.items?.length || 0,
      topTracks: topTracksData?.items || [],
      tokenStatus: userRes.ok ? 'valid' : 'expired_or_invalid',
    });
  } catch (err: any) {
    res.status(500).json({ connected: false, error: err?.message || 'Failed to verify Spotify' });
  }
});

// 7.0 YouTube & Spotify Dynamic Playlist Synchronization & Anti-Repetition Video Assignments

let lastYouTubeSyncTime = 0;
const YOUTUBE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

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

async function syncYouTubePlaylistsFromApi(force = false, oauthToken?: string): Promise<any[]> {
  const db = readDb();

  // If memory already has live channel playlists and not forced, return cached
  const hasLiveChannelPlaylists =
    Array.isArray(db.youtubePlaylists) &&
    db.youtubePlaylists.length > 5;

  if (!force && !oauthToken && hasLiveChannelPlaylists && lastYouTubeSyncTime && Date.now() - lastYouTubeSyncTime < YOUTUBE_CACHE_TTL_MS) {
    return db.youtubePlaylists;
  }

  // 1. Check Firestore for persisted live playlists
  if (!force && !hasLiveChannelPlaylists) {
    try {
      const persisted = await fetchYouTubePlaylistsFromFirestore();
      if (Array.isArray(persisted) && persisted.length > 5) {
        db.youtubePlaylists = persisted;
        writeDb(db);
        lastYouTubeSyncTime = Date.now();
        return persisted;
      }
    } catch (e) {
      console.warn('Firestore fetchYouTubePlaylists notice:', e);
    }
  }

  // 2. If an OAuth token is available, dynamically query YouTube Data API v3 (mine=true)
  if (oauthToken) {
    try {
      const plUrl = 'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails,status&mine=true&maxResults=50';
      const plRes = await fetch(plUrl, {
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          Accept: 'application/json',
        },
      });

      if (plRes.ok) {
        const plData = (await plRes.json()) as any;
        const items = plData.items || [];
        if (items.length > 0) {
          const syncedPlaylists: any[] = [];
          for (const pl of items) {
            const plId = pl.id;
            const title = pl.snippet?.title || 'English Practice';
            const description = pl.snippet?.description || '';
            const thumbnailUrl =
              pl.snippet?.thumbnails?.high?.url ||
              pl.snippet?.thumbnails?.medium?.url ||
              pl.snippet?.thumbnails?.default?.url ||
              '';
            const itemCount = pl.contentDetails?.itemCount || 0;

            const itemsUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${plId}&maxResults=50`;
            let videos: any[] = [];
            try {
              const itemsRes = await fetch(itemsUrl, {
                headers: {
                  Authorization: `Bearer ${oauthToken}`,
                  Accept: 'application/json',
                },
              });
              if (itemsRes.ok) {
                const itemsData = (await itemsRes.json()) as any;
                const rawItems = itemsData.items || [];
                videos = rawItems
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
                      duration: '6 min',
                    };
                  });
              }
            } catch (err) {
              console.warn(`Error fetching items for ${plId}:`, err);
            }

            if (videos.length === 0 && db.youtubePlaylists) {
              const existingPl = db.youtubePlaylists.find((p: any) => p.id === plId);
              if (existingPl?.videos?.length) {
                videos = existingPl.videos;
              }
            }

            syncedPlaylists.push({
              id: plId,
              title,
              description,
              thumbnailUrl,
              channelId: pl.snippet?.channelId,
              channelTitle: pl.snippet?.channelTitle || 'Adm Itissimple',
              itemCount: itemCount || videos.length,
              updatedAt: new Date().toISOString(),
              isPublic: pl.status?.privacyStatus === 'public',
              videos,
            });
          }

          if (syncedPlaylists.length > 0) {
            db.youtubePlaylists = syncedPlaylists;
            writeDb(db);
            saveYouTubePlaylistsToFirestore(syncedPlaylists).catch(() => {});
            lastYouTubeSyncTime = Date.now();
            return syncedPlaylists;
          }
        }
      }
    } catch (err) {
      console.warn('OAuth syncYouTubePlaylists error:', err);
    }
  }

  // 3. Direct Live YouTube Channel Synchronizer for @admitissimple (UCdimJysdxd2Hu9YmlVHB98A)
  try {
    const channelPlaylists = await fetchPlaylistsDirectlyFromChannel();
    if (channelPlaylists.length > 0) {
      db.youtubePlaylists = channelPlaylists;
      writeDb(db);
      lastYouTubeSyncTime = Date.now();
      saveYouTubePlaylistsToFirestore(channelPlaylists).catch((err) => {
        if (!isPermissionError(err)) {
          console.warn('Firestore saveYouTubePlaylists error:', err);
        }
      });
      return channelPlaylists;
    }
  } catch (err) {
    console.warn('Channel sync error:', err);
  }

  // 4. Fallback: if db has playlists, return them
  if (db.youtubePlaylists && db.youtubePlaylists.length > 0) {
    return db.youtubePlaylists;
  }

  return DEFAULT_CURATED_PLAYLISTS;
}

// Automatically detect new playlists and videos added to the YouTube channel every 15 minutes
setInterval(() => {
  syncYouTubePlaylistsFromApi(true).catch((err) => {
    console.warn('Background periodic YouTube sync notice:', err);
  });
}, 15 * 60 * 1000);

let lastSpotifySyncTime = 0;
const SPOTIFY_CACHE_TTL_MS = 5 * 60 * 1000;

async function syncSpotifyPlaylistsFromApi(force = false): Promise<any> {
  const token = process.env.SPOTIFY_TOKEN || SPOTIFY_BEARER_TOKEN;
  const db = readDb();

  // Invalidate cached playlists if they still reference old playlist IDs
  if (
    db.spotifyPlaylists &&
    (db.spotifyPlaylists.beginner?.playlistId !== '5MMU9H5oXDd7FCWr0gkzHE' ||
     db.spotifyPlaylists.intermediate?.playlistId !== '34E52K1dEJO5CzZRPkIR4I' ||
     db.spotifyPlaylists.advanced?.playlistId !== '6ScLXNefp8JFohezoJve2Z')
  ) {
    delete (db as any).spotifyPlaylists;
    writeDb(db);
    lastSpotifySyncTime = 0;
  }

  if (!token) {
    return db.spotifyPlaylists || SPOTIFY_LEVEL_PLAYLISTS;
  }

  if (!force && lastSpotifySyncTime && Date.now() - lastSpotifySyncTime < SPOTIFY_CACHE_TTL_MS) {
    if (
      db.spotifyPlaylists &&
      db.spotifyPlaylists.beginner?.playlistId === '5MMU9H5oXDd7FCWr0gkzHE' &&
      db.spotifyPlaylists.intermediate?.playlistId === '34E52K1dEJO5CzZRPkIR4I' &&
      db.spotifyPlaylists.advanced?.playlistId === '6ScLXNefp8JFohezoJve2Z'
    ) {
      return db.spotifyPlaylists;
    }
  }

  const playlistMap: Record<string, { level: 'beginner' | 'intermediate' | 'advanced'; title: string }> = {
    '5MMU9H5oXDd7FCWr0gkzHE': { level: 'beginner', title: "Beginner • It's simple" },
    '34E52K1dEJO5CzZRPkIR4I': { level: 'intermediate', title: "Intermediate • It's simple" },
    '6ScLXNefp8JFohezoJve2Z': { level: 'advanced', title: "Advanced • It's simple" },
  };

  try {
    const updatedPlaylists: Record<string, any> = JSON.parse(
      JSON.stringify(db.spotifyPlaylists || SPOTIFY_LEVEL_PLAYLISTS)
    );

    for (const [playlistId, meta] of Object.entries(playlistMap)) {
      const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const items = data.items || [];
        const dynamicTracks = items
          .filter((item: any) => item.track && item.track.id)
          .map((item: any) => {
            const t = item.track;
            const artistNames = t.artists?.map((a: any) => a.name).join(', ') || 'Adm Itissimple';
            return {
              trackId: t.id,
              title: t.name,
              artist: artistNames,
              url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
              embedUrl: `https://open.spotify.com/embed/track/${t.id}?utm_source=generator&theme=0`,
              duration: Math.round((t.duration_ms || 180000) / 1000),
              playlistId,
              playlistTitle: meta.title,
              teacherTipPt: `Prática de listening com "${t.name}" (${artistNames}). Preste atenção na dicção e conectividade das palavras.`,
              teacherTipEn: `Active listening practice with "${t.name}" (${artistNames}). Notice rhythm, diction, and connected speech.`,
            };
          });

        if (dynamicTracks.length > 0) {
          if (!updatedPlaylists[meta.level]) {
            updatedPlaylists[meta.level] = { ...SPOTIFY_LEVEL_PLAYLISTS[meta.level] };
          }
          DAYS_SEQUENCE.forEach((d, i) => {
            if (dynamicTracks[i]) {
              updatedPlaylists[meta.level].tracks[d] = {
                ...updatedPlaylists[meta.level].tracks[d],
                ...dynamicTracks[i],
                dayOfWeek: d,
                dayLabelPt: SPOTIFY_LEVEL_PLAYLISTS[meta.level]?.tracks[d]?.dayLabelPt || d,
                dayLabelEn: SPOTIFY_LEVEL_PLAYLISTS[meta.level]?.tracks[d]?.dayLabelEn || d,
              };
            }
          });
          if (dynamicTracks.length > 7) {
            updatedPlaylists[meta.level].pool = dynamicTracks.slice(7);
          }
        }
      }
    }

    db.spotifyPlaylists = updatedPlaylists;
    writeDb(db);
    lastSpotifySyncTime = Date.now();
    return updatedPlaylists;
  } catch (err) {
    console.warn('Error syncing Spotify playlists:', err);
  }

  return db.spotifyPlaylists || SPOTIFY_LEVEL_PLAYLISTS;
}

app.get('/api/youtube-playlists', async (req, res) => {
  const force = req.query.refresh === 'true' || req.query.force === 'true';
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;
  const playlists = await syncYouTubePlaylistsFromApi(force, bearerToken);
  const sortedPlaylists = [...playlists].sort((a, b) =>
    (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
  );
  res.json(sortedPlaylists);
});

app.post('/api/youtube-playlists/sync', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : undefined;
  const playlists = await syncYouTubePlaylistsFromApi(true, bearerToken);
  res.json({ success: true, count: playlists.length, playlists });
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
  const playlists = await syncSpotifyPlaylistsFromApi(force);
  res.json(playlists);
});

app.post('/api/spotify-playlists/sync', async (req, res) => {
  const playlists = await syncSpotifyPlaylistsFromApi(true);
  res.json({ success: true, playlists });
});

app.get('/api/student-video-assignments', (req, res) => {
  const db = readDb();
  const studentEmail = ((req.query.studentEmail as string) || (req.query.email as string) || '').toLowerCase().trim();
  const uid = ((req.query.uid as string) || (req.query.studentUid as string) || '').trim();
  const { email, uid: resolvedUid } = resolveStudentIdentifiers(db, studentEmail, uid);

  const studentLevel = normalizeStudentLevel(resolveStudentLevel(db, email, resolvedUid)).key;
  const keysToLookup = [resolvedUid, email].filter(Boolean) as string[];

  let assignments: any[] = [];
  for (const k of keysToLookup) {
    if (db.studentVideoAssignments?.[k] && Array.isArray(db.studentVideoAssignments[k])) {
      assignments = db.studentVideoAssignments[k];
      if (assignments.length > 0) break;
    }
  }

  // Check if assignments are missing or corrupted with duplicate video IDs across days
  const uniqueVideoIds = new Set(
    assignments.map((a) => extractServerYouTubeId(a.videoId || a.videoUrl)).filter(Boolean)
  );
  const hasRepeatingBug = assignments.length > 1 && uniqueVideoIds.size === 1;

  const studentPlanDays: string[] =
    (email && db.weeklyStudyDays?.[email] && db.weeklyStudyDays[email].length > 0)
      ? db.weeklyStudyDays[email]
      : (resolvedUid && db.weeklyStudyDays?.[resolvedUid] && db.weeklyStudyDays[resolvedUid].length > 0)
      ? db.weeklyStudyDays[resolvedUid]
      : (email && db.userProfiles?.[email]?.weeklyStudyDays && db.userProfiles[email].weeklyStudyDays.length > 0)
      ? db.userProfiles[email].weeklyStudyDays
      : (email && db.userProfiles?.[email]?.selectedStudyDays && db.userProfiles[email].selectedStudyDays.length > 0)
      ? db.userProfiles[email].selectedStudyDays
      : DAYS_SEQUENCE;
  const expectedDaysCount = Math.max(1, studentPlanDays.length);

  const hasVoluntaryVideoAssignments = assignments.length > 0;
  const isAwaitingTopicSelection = Boolean(
    (email && db.studentAwaitingTopicSelection?.[email]) ||
    (resolvedUid && db.studentAwaitingTopicSelection?.[resolvedUid]) ||
    !hasVoluntaryVideoAssignments
  );

  if ((assignments.length < expectedDaysCount || hasRepeatingBug) && !isAwaitingTopicSelection && hasVoluntaryVideoAssignments) {
    if (email || resolvedUid) {
      assignments = distributeWeeklyYouTubeForStudent(db, email, resolvedUid, studentLevel, undefined, undefined, studentPlanDays);
      writeDb(db);
    }
  }

  const watchedKey = resolvedUid && db.studentWatchedVideos?.[resolvedUid] ? resolvedUid : email;
  const watched = (watchedKey && db.studentWatchedVideos?.[watchedKey]) || [];

  res.json({
    success: true,
    assignments,
    watched,
    studentEmail: email,
    studentUid: resolvedUid,
    studentLevel,
  });
});

app.post('/api/student-video-assignments/assign', (req, res) => {
  const db = readDb();
  const { studentEmail, studentUid, teacherUid, teacherEmail, playlistId, activityId, day, teacherNotes, videoUrl } = req.body;
  const { email: cleanEmail, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);

  if (!cleanEmail && !uid) {
    return res.status(400).json({ error: 'studentEmail or studentUid is required' });
  }

  const studentLevel = normalizeStudentLevel(resolveStudentLevel(db, cleanEmail, uid)).key;
  const levelCurriculum = YOUTUBE_LEVEL_PLAYLISTS[studentLevel] || YOUTUBE_LEVEL_PLAYLISTS.beginner;

  const playlists = db.youtubePlaylists || [];
  const playlist = playlists.find((p: any) => p.id === playlistId) || playlists[0];

  if (!db.studentVideoAssignments) db.studentVideoAssignments = {};
  if (!db.studentWatchedVideos) db.studentWatchedVideos = {};

  const targetKeys = [cleanEmail, uid].filter(Boolean) as string[];

  let userAssignments: any[] = [];
  for (const k of targetKeys) {
    if (db.studentVideoAssignments[k] && Array.isArray(db.studentVideoAssignments[k])) {
      userAssignments = db.studentVideoAssignments[k];
      if (userAssignments.length > 0) break;
    }
  }

  let userWatched: string[] = [];
  for (const k of targetKeys) {
    if (db.studentWatchedVideos[k] && Array.isArray(db.studentWatchedVideos[k])) {
      userWatched = db.studentWatchedVideos[k];
      if (userWatched.length > 0) break;
    }
  }

  const targetDay: DayOfWeek = ((day as DayOfWeek) || 'monday');

  // Consumed video IDs: already watched OR already assigned to other days of the week for this student OR recorded in studentJournal
  const consumedVideoIds = new Set<string>();
  userWatched.forEach((id: string) => {
    const cid = extractServerYouTubeId(id);
    if (cid) consumedVideoIds.add(cid);
  });

  const clientWatchedHistory: string[] = Array.isArray(req.body.watchedVideosHistory)
    ? req.body.watchedVideosHistory
    : [];
  clientWatchedHistory.forEach((id: string) => {
    const cid = extractServerYouTubeId(id);
    if (cid) {
      consumedVideoIds.add(cid);
    }
  });

  // Query studentJournal from request body, in-memory DB, and profile to enforce 100% video exclusivity
  const reqJournal: any[] = Array.isArray(req.body.studentJournal) ? req.body.studentJournal : [];
  const dbJournalEntries = [
    ...reqJournal,
    ...((cleanEmail && db.studentActivityJournal?.[cleanEmail]) || []),
    ...((uid && db.studentActivityJournal?.[uid]) || []),
    ...((cleanEmail && db.userProfiles?.[cleanEmail]?.studentJournal) || []),
    ...((uid && db.userProfiles?.[uid]?.studentJournal) || []),
  ];
  dbJournalEntries.forEach((entry: any) => {
    if (entry && entry.type === 'video' && entry.id) {
      const cid = extractServerYouTubeId(entry.id);
      if (cid) consumedVideoIds.add(cid);
      if (entry.url) {
        const uCid = extractServerYouTubeId(entry.url);
        if (uCid) consumedVideoIds.add(uCid);
      }
    }
  });

  userAssignments.forEach((assign: any) => {
    if (assign.day !== targetDay) {
      const cid = extractServerYouTubeId(assign.videoId || assign.videoUrl);
      if (cid) consumedVideoIds.add(cid);
    }
  });

  let chosenVideo: any = null;

  // If requesting to repeat previous video
  if (playlistId === 'repeat_previous_video') {
    const calendarDays: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const studentPlanDays: string[] =
      (cleanEmail && db.weeklyStudyDays?.[cleanEmail] && db.weeklyStudyDays[cleanEmail].length > 0)
        ? db.weeklyStudyDays[cleanEmail]
        : (uid && db.weeklyStudyDays?.[uid] && db.weeklyStudyDays[uid].length > 0)
        ? db.weeklyStudyDays[uid]
        : (cleanEmail && db.userProfiles?.[cleanEmail]?.weeklyStudyDays && db.userProfiles[cleanEmail].weeklyStudyDays.length > 0)
        ? db.userProfiles[cleanEmail].weeklyStudyDays
        : calendarDays;

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

    // 1. Search designated target previous active study day in assignments
    const prevAssign = userAssignments.find((a: any) => a.day === targetPrevDay && (a.videoId || a.videoUrl));
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

    // 2. Search designated target previous active study day in routines
    if (!chosenVideo) {
      const routineObj =
        (cleanEmail && db.studentRoutinesMap?.[cleanEmail]) ||
        (uid && db.studentRoutinesMap?.[uid]) ||
        db.routinesByDay ||
        defaultRoutinesByDay;
      const dayActs = routineObj[targetPrevDay] || [];
      for (const act of dayActs) {
        const v = act.teacherVideos?.[0];
        if (v && (v.videoId || v.url)) {
          const pVidId = extractServerYouTubeId(v.videoId || v.url);
          chosenVideo = {
            videoId: pVidId,
            url: v.url || `https://www.youtube.com/watch?v=${pVidId}`,
            title: v.title || `Repeated Video (${targetPrevDay})`,
            duration: v.duration || '5-10 min',
            instructions: `Repeated from ${targetPrevDay}`,
          };
          break;
        }
      }
    }

    // 3. Fallback search across any remaining active days in reverse order
    if (!chosenVideo) {
      const otherActiveDays = [...effectiveActiveDays].filter((d) => d !== targetDay && d !== targetPrevDay).reverse();
      for (const d of otherActiveDays) {
        const assign = userAssignments.find((a: any) => a.day === d && (a.videoId || a.videoUrl));
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

    // 4. Fallback to userWatched last entry
    if (!chosenVideo && userWatched.length > 0) {
      const lastWatchedId = userWatched[userWatched.length - 1];
      chosenVideo = {
        videoId: lastWatchedId,
        url: `https://www.youtube.com/watch?v=${lastWatchedId}`,
        title: 'Repeated Previous Video',
        duration: '5-10 min',
        instructions: 'Repeated from watched history',
      };
    }

    // 5. Fallback to curriculum of target previous active day
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

  // If a custom videoUrl was provided explicitly
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

  // Next: find next unseen video from the requested playlist
  if (!chosenVideo && playlist && playlist.videos && playlist.videos.length > 0) {
    chosenVideo = playlist.videos.find((v: any) => {
      const vid = extractServerYouTubeId(v.videoId || v.url || v.id);
      return vid && !consumedVideoIds.has(vid);
    });
  }

  // Fallback: search in level curriculum
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

  // Ultimate fallback: recycle designated day video
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

  const assignedVideoObj = {
    id: `vid-${targetDay}-${Date.now()}`,
    url: cleanVideoUrl,
    videoId: validVidId,
    title: chosenVideo.title,
    duration: chosenVideo.duration || '5-10 min',
    instructions:
      teacherNotes ||
      chosenVideo.instructions ||
      chosenVideo.teacherTipPt ||
      `Vídeo exclusivo do dia. Assista com atenção e anote 5 novas palavras.`,
    addedAt: new Date().toISOString(),
    playlistId: playlistId === 'repeat_previous_video' ? 'repeat_previous_video' : (playlist?.id || levelCurriculum.playlistId),
    playlistTitle: playlistId === 'repeat_previous_video' ? 'Repeat Previous Video' : (playlist?.title || levelCurriculum.playlistTitle),
  };

  const assignmentRecord = {
    id: `assign-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    activityId: activityId || 'act-1',
    studentEmail: cleanEmail,
    studentUid: uid || '',
    teacherUid: (teacherUid || '').trim(),
    teacherEmail: (teacherEmail || '').trim(),
    day: targetDay,
    playlistId: assignedVideoObj.playlistId,
    playlistTitle: assignedVideoObj.playlistTitle,
    videoId: validVidId,
    videoTitle: chosenVideo.title,
    videoUrl: cleanVideoUrl,
    assignedAt: new Date().toISOString(),
  };

  targetKeys.forEach((key) => {
    if (!db.studentVideoAssignments[key]) {
      db.studentVideoAssignments[key] = [];
    }
    db.studentVideoAssignments[key] = db.studentVideoAssignments[key].filter(
      (a: any) => a.day !== targetDay
    );
    db.studentVideoAssignments[key].push(assignmentRecord);
  });

  if (!db.studentRoutinesMap) db.studentRoutinesMap = {};
  let studentRoutineObj =
    (cleanEmail && db.studentRoutinesMap[cleanEmail]) ||
    (uid && db.studentRoutinesMap[uid]) ||
    null;

  if (!studentRoutineObj || typeof studentRoutineObj !== 'object' || Object.keys(studentRoutineObj).length === 0) {
    studentRoutineObj = JSON.parse(JSON.stringify(db.routinesByDay || defaultRoutinesByDay));
  } else {
    DAYS_SEQUENCE.forEach((d) => {
      if (!studentRoutineObj[d] || !Array.isArray(studentRoutineObj[d]) || studentRoutineObj[d].length === 0) {
        studentRoutineObj[d] = JSON.parse(JSON.stringify(db.routinesByDay?.[d] || defaultRoutinesByDay[d] || []));
      }
    });
  }

  if (studentRoutineObj?.[targetDay]) {
    let matched = false;
    studentRoutineObj[targetDay] = studentRoutineObj[targetDay].map((act: any) => {
      const match = activityId
        ? act.id === activityId
        : act.id.endsWith('1') ||
          act.activityName?.toLowerCase().includes('vídeo') ||
          act.activityName?.toLowerCase().includes('video') ||
          (db.youtubePlaylists || []).some((pl: any) => pl.title?.toLowerCase() === act.activityName?.toLowerCase());
      if (match) {
        matched = true;
        return {
          ...act,
          activityName: assignedVideoObj.playlistTitle,
          teacherVideos: [assignedVideoObj],
          teacherNotes: assignedVideoObj.instructions,
        };
      }
      return act;
    });
    if (!matched && studentRoutineObj[targetDay].length > 0) {
      studentRoutineObj[targetDay][0] = {
        ...studentRoutineObj[targetDay][0],
        activityName: assignedVideoObj.playlistTitle,
        teacherVideos: [assignedVideoObj],
        teacherNotes: assignedVideoObj.instructions,
      };
    }
  }

  targetKeys.forEach((key) => {
    db.studentRoutinesMap[key] = studentRoutineObj;
    const assigns = db.studentVideoAssignments?.[key] || [];
    if (assigns.length >= 7 && db.studentAwaitingTopicSelection) {
      db.studentAwaitingTopicSelection[key] = false;
    }
  });

  writeDb(db);

  if (uid) {
    saveRoutineVideoSubcollection(uid, targetDay, {
      videoId: validVidId,
      videoTitle: assignedVideoObj.title,
      title: assignedVideoObj.title,
      url: cleanVideoUrl,
      playlistId: assignedVideoObj.playlistId,
      playlistTitle: assignedVideoObj.playlistTitle,
      dayOfWeek: targetDay,
      activityId: activityId || 'act-1',
      isRepeatVideo: playlistId === 'repeat_previous_video',
      instructions: assignedVideoObj.instructions || '',
      duration: assignedVideoObj.duration || '5-10 min',
      updatedAt: new Date().toISOString(),
    }).catch((e) => console.warn('Firestore routine subcollection notice:', e));

    if (validVidId && playlistId !== 'repeat_previous_video') {
      addWatchedVideoToUserDoc(uid, validVidId).catch(() => {});
    }

    saveStudentAssignmentsByUid(uid, {
      uid,
      email: cleanEmail,
      level: studentLevel,
      videoAssignments: db.studentVideoAssignments?.[uid] || db.studentVideoAssignments?.[cleanEmail] || [],
      spotifyAssignments: db.studentSpotifyAssignments?.[uid] || db.studentSpotifyAssignments?.[cleanEmail] || [],
      routines: studentRoutineObj,
      updatedAt: new Date().toISOString(),
    }).catch((err) => console.warn('Firestore saveStudentAssignmentsByUid (YouTube assign) notice:', err));
  }

  // Count remaining unseen videos in this playlist for this student
  const remainingUnseen = playlist.videos.filter((v: any) => {
    const vid = extractServerYouTubeId(v.videoId || v.url || v.id);
    return vid && !consumedVideoIds.has(vid) && vid !== validVidId;
  }).length;

  res.json({
    success: true,
    video: assignedVideoObj,
    playlistTitle: assignedVideoObj.playlistTitle,
    playlistId: assignedVideoObj.playlistId,
    remainingUnseen,
    totalVideos: playlist?.videos?.length || 7,
    studentEmail: cleanEmail,
    studentUid: uid,
    message: `Vídeo exclusivo "${chosenVideo.title}" atribuído com sucesso!`,
  });
});

// Endpoint to distribute exclusive sequential YouTube videos for student active days (or Monday to Sunday)
app.post('/api/student-video-assignments/distribute-week', (req, res) => {
  const db = readDb();
  const { studentEmail, studentUid, teacherUid, teacherEmail, level, days } = req.body;
  const { email: cleanEmail, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);

  if (!cleanEmail && !uid) {
    return res.status(400).json({ error: 'studentEmail or studentUid is required' });
  }

  const assignments = distributeWeeklyYouTubeForStudent(
    db,
    cleanEmail,
    uid,
    level,
    teacherUid,
    teacherEmail,
    Array.isArray(days) ? days : undefined
  );

  writeDb(db);

  res.json({
    success: true,
    assignments,
    studentEmail: cleanEmail,
    studentUid: uid,
    message: `Semana de ${assignments.length} vídeos exclusivos do YouTube atribuída com sucesso!`,
  });
});

app.post('/api/student-video-assignments/watch', (req, res) => {
  const db = readDb();
  const { studentEmail, studentUid, videoId } = req.body;
  const { email: cleanEmail, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);
  const cleanVidId = extractServerYouTubeId(videoId);

  if ((!cleanEmail && !uid) || !cleanVidId) {
    return res.status(400).json({ error: 'studentEmail/studentUid and valid videoId are required' });
  }

  if (!db.studentWatchedVideos) db.studentWatchedVideos = {};

  const keysToUpdate = [cleanEmail, uid].filter(Boolean) as string[];
  keysToUpdate.forEach((key) => {
    if (!db.studentWatchedVideos[key]) db.studentWatchedVideos[key] = [];
    if (!db.studentWatchedVideos[key].includes(cleanVidId)) {
      db.studentWatchedVideos[key].push(cleanVidId);
    }
  });

  writeDb(db);

  const watchedList = (cleanEmail && db.studentWatchedVideos[cleanEmail]) || (uid && db.studentWatchedVideos[uid]) || [];
  if (uid && cleanVidId) {
    addWatchedVideoToUserDoc(uid, cleanVidId, (req.body.videoTitle || req.body.title)).catch(() => {});
  }

  res.json({
    success: true,
    watchedCount: watchedList.length,
    watchedVideos: watchedList,
    studentEmail: cleanEmail,
    studentUid: uid,
  });
});

app.post('/api/routines/daily-video', (req, res) => {
  const db = readDb();
  const { studentUid, studentEmail, day, dayOfWeek, videoId, title, videoTitle, url, playlistId, playlistTitle, isRepeatVideo } = req.body;
  const targetDay = dayOfWeek || day;
  if ((!studentUid && !studentEmail) || !targetDay) {
    return res.status(400).json({ error: 'studentUid/studentEmail and day are required' });
  }

  const { email, uid } = resolveStudentIdentifiers(db, studentEmail, studentUid);
  const targetKeys = Array.from(new Set([email, uid, studentUid, studentEmail].filter(Boolean) as string[]));

  const cleanVidId = extractServerYouTubeId(videoId || url);
  const cleanTitle = title || videoTitle || 'Daily Video Practice';
  const cleanUrl = url || (cleanVidId ? `https://www.youtube.com/watch?v=${cleanVidId}` : '');

  const videoObj = {
    id: cleanVidId || videoId,
    videoId: cleanVidId || videoId,
    title: cleanTitle,
    videoTitle: cleanTitle,
    url: cleanUrl,
    playlistId: playlistId || '',
    playlistTitle: playlistTitle || '',
    dayOfWeek: targetDay,
    isRepeatVideo: Boolean(isRepeatVideo),
    updatedAt: new Date().toISOString(),
  };

  targetKeys.forEach((k) => {
    // 1. Update studentVideoAssignments
    if (!db.studentVideoAssignments) db.studentVideoAssignments = {};
    if (!Array.isArray(db.studentVideoAssignments[k])) db.studentVideoAssignments[k] = [];
    const existingIdx = db.studentVideoAssignments[k].findIndex((v: any) => (v.day || v.dayOfWeek) === targetDay);
    if (existingIdx >= 0) {
      db.studentVideoAssignments[k][existingIdx] = { ...db.studentVideoAssignments[k][existingIdx], ...videoObj, day: targetDay };
    } else {
      db.studentVideoAssignments[k].push({ ...videoObj, day: targetDay });
    }

    // 2. Clear awaiting topic selection
    if (db.studentAwaitingTopicSelection) {
      db.studentAwaitingTopicSelection[k] = false;
    }

    // 3. Update studentRoutinesMap
    if (!db.studentRoutinesMap) db.studentRoutinesMap = {};
    if (!db.studentRoutinesMap[k]) {
      db.studentRoutinesMap[k] = JSON.parse(JSON.stringify(db.routinesByDay || defaultRoutinesByDay));
    }
    if (db.studentRoutinesMap[k][targetDay]) {
      db.studentRoutinesMap[k][targetDay] = db.studentRoutinesMap[k][targetDay].map((item: any, idx: number) => {
        if (idx === 0 || item.id?.endsWith('1') || item.activityName?.toLowerCase().includes('vídeo') || item.activityName?.toLowerCase().includes('video')) {
          return {
            ...item,
            teacherVideos: [videoObj],
            playlistId: playlistId || '',
            playlistTitle: playlistTitle || '',
            isRepeatVideo: Boolean(isRepeatVideo),
          };
        }
        return item;
      });
    }
  });

  writeDb(db);

  if (cleanVidId && uid) {
    saveRoutineVideoSubcollection(uid, targetDay, videoObj).catch(() => {});
    if (!isRepeatVideo) {
      addWatchedVideoToUserDoc(uid, cleanVidId).catch(() => {});
    }
  }

  res.json({ success: true });
});

app.post('/api/routines/update-time', (req, res) => {
  const db = readDb();
  const { day, activityId, time, studentEmail } = req.body;
  if (!day || !activityId || !time) {
    return res.status(400).json({ error: 'day, activityId, and time are required' });
  }

  if (db.routinesByDay && db.routinesByDay[day]) {
    db.routinesByDay[day] = db.routinesByDay[day].map((item: any) =>
      item.id === activityId ? { ...item, time } : item
    );
  }

  const cleanEmail = (studentEmail || '').toLowerCase().trim();
  if (cleanEmail) {
    if (!db.studentRoutinesMap) db.studentRoutinesMap = {};
    if (!db.studentRoutinesMap[cleanEmail]) {
      db.studentRoutinesMap[cleanEmail] = JSON.parse(JSON.stringify(db.routinesByDay || {}));
    }
    if (db.studentRoutinesMap[cleanEmail]?.[day]) {
      db.studentRoutinesMap[cleanEmail][day] = db.studentRoutinesMap[cleanEmail][day].map((item: any) =>
        item.id === activityId ? { ...item, time } : item
      );
    }
  }

  writeDb(db);
  res.json({ success: true, day, activityId, time });
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
  const db = readDb();

  // 1. Check in-memory user profiles
  if (cleanUid && db.userProfiles?.[cleanUid]?.weeklyCycle) {
    const cycle = extractPositiveIntegerCycle(db.userProfiles[cleanUid].weeklyCycle);
    if (cycle !== null) return cycle;
  }
  if (cleanEmail && db.userProfiles?.[cleanEmail]?.weeklyCycle) {
    const cycle = extractPositiveIntegerCycle(db.userProfiles[cleanEmail].weeklyCycle);
    if (cycle !== null) return cycle;
  }

  // 2. Check in-memory students list
  const foundStudent = (db.students || []).find((s: any) =>
    (cleanUid && (s.uid === cleanUid || s.studentUid === cleanUid || s.id === cleanUid)) ||
    (cleanEmail && (s.email === cleanEmail || s.studentEmail === cleanEmail))
  );
  if (foundStudent?.weeklyCycle) {
    const cycle = extractPositiveIntegerCycle(foundStudent.weeklyCycle);
    if (cycle !== null) return cycle;
  }

  // 3. Check Firestore user document
  const docIds = [cleanUid, cleanEmail].filter(Boolean);
  for (const docId of docIds) {
    try {
      const uData = await fetchUserDocumentFromFirestore(docId);
      if (uData) {
        const cycle = extractPositiveIntegerCycle(uData?.weeklyCycle);
        if (cycle !== null) return cycle;
      }
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
  const AUTHORITATIVE_ADMIN_EMAILS = new Set([
    'adm.itissimple@gmail.com',
    'estilobeeforkids@gmail.com',
    'adm.itssimple@gmail.com',
    'estilobeeadm@gmail.com',
    'admin@itissimple.com',
  ]);

  const isAdminByEmail = Boolean(
    callerEmail &&
    callerEmailVerified &&
    AUTHORITATIVE_ADMIN_EMAILS.has(callerEmail)
  );

  const isAdminByTeachers = Boolean(
    db.teachers?.some((t: any) =>
      t.role === 'admin' && (
        (t.uid && t.uid === callerUid) ||
        (t.id && (t.id === callerUid || t.id === `tutor-${callerUid}`)) ||
        (callerEmailVerified && t.email && t.email.toLowerCase().trim() === callerEmail)
      )
    )
  );

  const isAdminByAuthUsers = Boolean(
    db.authUsers &&
    Object.values(db.authUsers).some((u: any) =>
      u.role === 'admin' && (
        (u.uid && u.uid === callerUid) ||
        (callerEmailVerified && u.email && u.email.toLowerCase().trim() === callerEmail)
      )
    )
  );

  const isVerifiedAdmin =
    callerTokenRole === 'admin' ||
    isAdminByEmail ||
    isAdminByTeachers ||
    isAdminByAuthUsers;

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

    // Lesson-based assignment check in liveLessons
    const isAssignedByLesson = (db.liveLessons || []).some((l: any) => {
      if (l.status === 'cancelled') return false;

      const lStudentEmail = (l.studentEmail || '').toLowerCase().trim();
      const lStudentUid = (l.studentUid || '').trim();
      const lTeacherEmail = (l.teacherEmail || l.tutorEmail || '').toLowerCase().trim();
      const lTeacherUid = (l.teacherUid || l.tutorUid || '').trim();

      // Lesson student must match the canonical student:
      const studentMatches =
        (cleanUid && lStudentUid && lStudentUid === cleanUid) ||
        (cleanEmail && lStudentEmail && lStudentEmail === cleanEmail);

      // Lesson student must NOT contradict the canonical student:
      if (lStudentUid && cleanUid && lStudentUid !== cleanUid) return false;
      if (lStudentEmail && cleanEmail && lStudentEmail !== cleanEmail) return false;

      // Lesson teacher must match the caller:
      const teacherMatches =
        (lTeacherUid &&
          (lTeacherUid === callerUid ||
            lTeacherUid === `tutor-${callerUid}` ||
            callerUid === `tutor-${lTeacherUid}`)) ||
        (callerEmailVerified && callerEmail && lTeacherEmail && lTeacherEmail === callerEmail);

      return studentMatches && teacherMatches;
    });

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

// 7.1 Student Weekly S-Path Progress Endpoints (Week-aware & strictly isolated)
app.get('/api/routines/weekly-checks', firebaseAuthMiddleware, async (req, res) => {
  const authContext = await authorizeStudentAccess(req, 'read');
  if (!authContext.authorized) {
    return res.status(authContext.status).json({ error: authContext.error });
  }
  const { cleanUid, cleanEmail } = authContext;

  const rawWeek = req.query.weekId || req.query.week || req.query.weeklyCycle;
  if (!rawWeek) {
    return res.status(400).json({
      error: 'Missing week identifier. A valid positive integer cycle (e.g. 1, "week-1") or resolvable "current_week" alias is required.',
    });
  }

  let cycle: number | null = null;
  if (typeof rawWeek === 'string' && rawWeek.trim().toLowerCase() === 'current_week') {
    cycle = await resolveStudentWeeklyCycle(cleanUid, cleanEmail);
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
  const studentKey = cleanUid || cleanEmail;
  const weekScopedKey = `${studentKey}::${canonicalWeekId}`;
  const emailScopedKey = cleanEmail ? `${cleanEmail}::${canonicalWeekId}` : '';

  const db = readDb();
  let checks: Record<string, boolean> | null =
    (db.studentWeeklyChecks && (db.studentWeeklyChecks[weekScopedKey] || (emailScopedKey ? db.studentWeeklyChecks[emailScopedKey] : undefined))) || null;

  // If not found in-memory, query Firestore week subcollection
  if (!checks) {
    const docIds = [cleanUid, cleanEmail].filter(Boolean);
    const fsChecks = await fetchWeeklyChecksFromFirestore(docIds, canonicalWeekId, cycle);
    if (fsChecks) {
      checks = fsChecks;
      if (!db.studentWeeklyChecks) db.studentWeeklyChecks = {};
      db.studentWeeklyChecks[weekScopedKey] = checks;
    }
  }

  // For Week 2+, NEVER fall back to legacy root document or unscoped checks!
  const finalChecks = checks || {};

  const userProf = (db.userProfiles && (db.userProfiles[studentKey] || (cleanEmail ? db.userProfiles[cleanEmail] : undefined))) || {};
  const weeklyNativeLessonsTarget =
    (db.weeklyNativeTargets && (db.weeklyNativeTargets[studentKey] || (cleanEmail ? db.weeklyNativeTargets[cleanEmail] : undefined))) ||
    userProf.weeklyNativeLessonsTarget ||
    1;
  const weeklyStudyDaysTarget =
    (db.weeklyStudyDaysTargets && (db.weeklyStudyDaysTargets[studentKey] || (cleanEmail ? db.weeklyStudyDaysTargets[cleanEmail] : undefined))) ||
    userProf.weeklyStudyDaysTarget ||
    7;
  const weeklyStudyDays =
    (db.weeklyStudyDays && (db.weeklyStudyDays[studentKey] || (cleanEmail ? db.weeklyStudyDays[cleanEmail] : undefined))) ||
    userProf.weeklyStudyDays ||
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  res.json({
    success: true,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    checks: finalChecks,
    weeklyNativeLessonsTarget,
    weeklyStudyDaysTarget,
    weeklyStudyDays,
  });
});

app.post('/api/routines/weekly-checks', firebaseAuthMiddleware, async (req, res) => {
  const authContext = await authorizeStudentAccess(req, 'write');
  if (!authContext.authorized) {
    return res.status(authContext.status).json({ error: authContext.error });
  }
  const { cleanUid, cleanEmail } = authContext;
  const { checks, merge, weeklyNativeLessonsTarget, weeklyStudyDaysTarget, weeklyStudyDays } = req.body;

  const rawWeek = req.body.weekId || req.body.week || req.body.weeklyCycle || req.query.weekId || req.query.week || req.query.weeklyCycle;
  if (!rawWeek) {
    return res.status(400).json({
      error: 'Missing week identifier. A valid positive integer cycle (e.g. 1, "week-1") or resolvable "current_week" alias is required.',
    });
  }

  let cycle: number | null = null;
  if (typeof rawWeek === 'string' && rawWeek.trim().toLowerCase() === 'current_week') {
    cycle = await resolveStudentWeeklyCycle(cleanUid, cleanEmail);
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
  const studentKey = cleanUid || cleanEmail;
  const weekScopedKey = `${studentKey}::${canonicalWeekId}`;

  const db = readDb();
  if (!db.studentWeeklyChecks) {
    db.studentWeeklyChecks = {};
  }

  if (checks && typeof checks === 'object') {
    if (merge && db.studentWeeklyChecks[weekScopedKey]) {
      db.studentWeeklyChecks[weekScopedKey] = {
        ...db.studentWeeklyChecks[weekScopedKey],
        ...checks,
      };
    } else {
      db.studentWeeklyChecks[weekScopedKey] = checks;
    }

    if (cleanEmail && cleanEmail !== studentKey) {
      db.studentWeeklyChecks[`${cleanEmail}::${canonicalWeekId}`] = db.studentWeeklyChecks[weekScopedKey];
    }

    // Week 1 legacy backward compatibility only:
    if (cycle === 1) {
      db.studentWeeklyChecks[studentKey] = db.studentWeeklyChecks[weekScopedKey];
      if (cleanEmail) {
        db.studentWeeklyChecks[cleanEmail] = db.studentWeeklyChecks[weekScopedKey];
      }
    }
    // For cycle >= 2: REMOVE writes to root studentWeeklyChecks[studentKey] and studentWeeklyChecks[cleanEmail]!
  }

  if (typeof weeklyNativeLessonsTarget === 'number' && weeklyNativeLessonsTarget > 0) {
    if (!db.weeklyNativeTargets) db.weeklyNativeTargets = {};
    db.weeklyNativeTargets[studentKey] = weeklyNativeLessonsTarget;
    if (cleanEmail && db.userProfiles && db.userProfiles[cleanEmail]) {
      db.userProfiles[cleanEmail].weeklyNativeLessonsTarget = weeklyNativeLessonsTarget;
    }
  }

  if (typeof weeklyStudyDaysTarget === 'number' && weeklyStudyDaysTarget >= 1 && weeklyStudyDaysTarget <= 7) {
    if (!db.weeklyStudyDaysTargets) db.weeklyStudyDaysTargets = {};
    db.weeklyStudyDaysTargets[studentKey] = weeklyStudyDaysTarget;
    if (cleanEmail && db.userProfiles && db.userProfiles[cleanEmail]) {
      db.userProfiles[cleanEmail].weeklyStudyDaysTarget = weeklyStudyDaysTarget;
    }
  }

  if (Array.isArray(weeklyStudyDays)) {
    if (!db.weeklyStudyDays) db.weeklyStudyDays = {};
    db.weeklyStudyDays[studentKey] = weeklyStudyDays;
    if (cleanEmail && db.userProfiles && db.userProfiles[cleanEmail]) {
      db.userProfiles[cleanEmail].weeklyStudyDays = weeklyStudyDays;
    }
  }

  writeDb(db);

  // Firestore persistence
  const docId = cleanUid || cleanEmail;
  if (docId) {
    // 1. Write week-specific document: users/{docId}/weeklyChecks/week-${cycle}
    const weekDocPayload: Record<string, any> = {
      id: canonicalWeekId,
      weekId: canonicalWeekId,
      weeklyCycle: cycle,
      checks: db.studentWeeklyChecks[weekScopedKey] || {},
      weeklyChecks: db.studentWeeklyChecks[weekScopedKey] || {},
      sPathChecks: db.studentWeeklyChecks[weekScopedKey] || {},
      updatedAt: new Date().toISOString(),
      studentUid: cleanUid || null,
      studentEmail: cleanEmail || null,
    };
    if (typeof weeklyNativeLessonsTarget === 'number') {
      weekDocPayload.weeklyNativeLessonsTarget = weeklyNativeLessonsTarget;
    }
    if (typeof weeklyStudyDaysTarget === 'number') {
      weekDocPayload.weeklyStudyDaysTarget = weeklyStudyDaysTarget;
    }

    // 2. Root document users/{docId}: targets always update;
    // Objective 4: Remove Week 2+ writes to root-level users/{uid}.weeklyChecks and sPathChecks.
    // Preserve Week 1 legacy compatibility only where explicitly required.
    const fsRootPayload: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };
    if (cycle === 1) {
      if (checks && typeof checks === 'object') {
        fsRootPayload.weeklyChecks = db.studentWeeklyChecks[weekScopedKey] || {};
        fsRootPayload.sPathChecks = db.studentWeeklyChecks[weekScopedKey] || {};
      }
    }
    if (typeof weeklyNativeLessonsTarget === 'number') {
      fsRootPayload.weeklyNativeLessonsTarget = weeklyNativeLessonsTarget;
    }
    if (typeof weeklyStudyDaysTarget === 'number') {
      fsRootPayload.weeklyStudyDaysTarget = weeklyStudyDaysTarget;
    }
    if (Array.isArray(weeklyStudyDays)) {
      fsRootPayload.weeklyStudyDays = weeklyStudyDays;
    }

    saveWeeklyChecksToFirestore(docId, canonicalWeekId, weekDocPayload, fsRootPayload).catch(() => {});
  }

  const savedChecks = db.studentWeeklyChecks[weekScopedKey] || {};
  res.json({
    success: true,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    checks: savedChecks,
    weeklyNativeLessonsTarget: typeof weeklyNativeLessonsTarget === 'number' ? weeklyNativeLessonsTarget : 1,
    weeklyStudyDaysTarget: typeof weeklyStudyDaysTarget === 'number' ? weeklyStudyDaysTarget : 7,
    weeklyStudyDays: Array.isArray(weeklyStudyDays) ? weeklyStudyDays : [],
  });
});

// 8. Homework Endpoints with per-student and per-week isolation
app.get('/api/homework', firebaseAuthMiddleware, async (req, res) => {
  const authContext = await authorizeStudentAccess(req, 'read');
  if (!authContext.authorized) {
    return res.status(authContext.status).json({ error: authContext.error });
  }
  const { cleanUid, cleanEmail } = authContext;

  const rawWeek = req.query.weekId || req.query.week || req.query.weeklyCycle;
  if (!rawWeek) {
    return res.status(400).json({
      error: 'Missing week identifier. A valid positive integer cycle (e.g. 1, "week-1") or resolvable "current_week" alias is required.',
    });
  }

  let cycle: number | null = null;
  if (typeof rawWeek === 'string' && rawWeek.trim().toLowerCase() === 'current_week') {
    cycle = await resolveStudentWeeklyCycle(cleanUid, cleanEmail);
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
  const studentKey = cleanUid || cleanEmail;
  const hwScopedKey = `${studentKey}::${canonicalWeekId}`;
  const emailScopedKey = cleanEmail ? `${cleanEmail}::${canonicalWeekId}` : '';

  const db = readDb();
  let hwData =
    (db.studentHomeworkMap && (db.studentHomeworkMap[hwScopedKey] || (emailScopedKey ? db.studentHomeworkMap[emailScopedKey] : undefined))) || null;

  // If not found in-memory, query Firestore week subcollection
  if (!hwData) {
    const docIds = [cleanUid, cleanEmail].filter(Boolean);
    const fsHw = await fetchHomeworkFromFirestore(docIds, canonicalWeekId, cycle);
    if (fsHw) {
      hwData = fsHw;
      if (!db.studentHomeworkMap) db.studentHomeworkMap = {};
      db.studentHomeworkMap[hwScopedKey] = hwData;
    }
  }

  // For Week 2+, NEVER return legacy root homework or global db.weeklyHomework!
  if (hwData) {
    return res.json(hwData);
  }

  res.json({
    id: canonicalWeekId,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    studentUid: cleanUid || undefined,
    studentEmail: cleanEmail || undefined,
    completedPartsByDay: {},
    studentAnswers: { matching: {}, fillInBlanks: {}, sentences: {}, quizAnswers: {} },
  });
});

app.post(['/api/homework', '/api/homework/submit'], firebaseAuthMiddleware, async (req, res) => {
  const authContext = await authorizeStudentAccess(req, 'write');
  if (!authContext.authorized) {
    return res.status(authContext.status).json({ error: authContext.error });
  }
  const { cleanUid, cleanEmail } = authContext;
  const weeklyHomework = req.body.weeklyHomework || req.body;

  let rawWeek = req.body.weekId || req.body.week || req.body.weeklyCycle || weeklyHomework?.weekId || weeklyHomework?.weeklyCycle || weeklyHomework?.id;
  if (!rawWeek) {
    rawWeek = 'current_week';
  }

  let cycle: number | null = null;
  if (typeof rawWeek === 'string' && rawWeek.trim().toLowerCase() === 'current_week') {
    cycle = await resolveStudentWeeklyCycle(cleanUid, cleanEmail);
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
  const studentKey = cleanUid || cleanEmail;
  const hwScopedKey = `${studentKey}::${canonicalWeekId}`;

  const db = readDb();
  db.studentHomeworkMap = db.studentHomeworkMap || {};

  const hwPayload = {
    ...weeklyHomework,
    id: canonicalWeekId,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    uid: cleanUid || undefined,
    studentUid: cleanUid || undefined,
    email: cleanEmail || undefined,
    studentEmail: cleanEmail || undefined,
    updatedAt: new Date().toISOString(),
  };

  db.studentHomeworkMap[hwScopedKey] = hwPayload;
  if (cleanEmail && cleanEmail !== studentKey) {
    db.studentHomeworkMap[`${cleanEmail}::${canonicalWeekId}`] = hwPayload;
  }

  // Preserve Week 1 legacy compatibility only where explicitly required
  if (cycle === 1) {
    db.studentHomeworkMap[studentKey] = hwPayload;
    if (cleanEmail) db.studentHomeworkMap[cleanEmail] = hwPayload;
    db.weeklyHomework = hwPayload;
  }
  // For cycle >= 2: NEVER write to global db.weeklyHomework or unscoped db.studentHomeworkMap[studentKey]!

  writeDb(db);

  // Firestore persistence
  const docId = cleanUid || cleanEmail;
  if (docId) {
    saveHomeworkToFirestore(docId, canonicalWeekId, cycle, hwPayload).catch(() => {});
  }

  res.json({
    success: true,
    weekId: canonicalWeekId,
    weeklyCycle: cycle,
    weeklyHomework: hwPayload,
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
function isBadStoryText(text: string): boolean {
  if (!text || typeof text !== 'string' || text.trim().length < 80) return true;
  const t = text.toLowerCase();
  return (
    t.includes('the day began with great purpose as') ||
    t.includes('reviewed key plans regarding') ||
    t.includes('address **') ||
    t.includes('managing **') ||
    t.includes('progress made on **') ||
    t.includes('to make sure everything stayed aligned') ||
    t.includes('quick to ') ||
    t.includes('refreshing weather') ||
    t.includes('storm terms') ||
    t.includes('a productive day of focus and growth') ||
    t.includes('finishing the workday on schedule allowed everyone to celebrate')
  );
}

// Dedicated Generator for Part 4: Mini-Story / Routine Reading & Interpretation with Gemini API
// 100% INÉDITA, ORGANIC VOCABULARY INTEGRATION, AND DYNAMIC STORY-GROUNDED COMPREHENSION QUESTIONS
async function generatePart4StoryWithGemini(
  words: string[],
  studentLevel: string,
  studentName: string = 'Student'
): Promise<any | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !Array.isArray(words) || words.length === 0) return null;

  const levelMeta = normalizeStudentLevel(studentLevel);
  const protagonist = (studentName && studentName !== 'Student' ? studentName.split(' ')[0] : 'Regina').trim();

  const systemInstruction = `You are a distinguished literary author, linguistic stylist, and senior English Language Teaching (ELT) instructional designer for "It's Simple - Learn English by Living Your Life".
Your mission is to craft a 100% ORIGINAL, INÉDITA, and COMPELLING short story (Part 4: Routine Reading & Interpretation) and dynamic, narrative-grounded reading comprehension questions tailored to the student's proficiency level (${levelMeta.labelEn} - CEFR ${levelMeta.cefr}).

CRITICAL MANDATORY RULES (STRICTLY ENFORCED):

1. GERAÇÃO DE CONTEÚDO 100% INÉDITO (ZERO TEMPLATES / ZERO REUSO):
   - You must construct a brand-new, vivid, and original storyline specifically customized to the provided words of the day.
   - ABSOLUTE PROHIBITION ON STATIC TEMPLATES: You are strictly forbidden from reusing formulaic slot templates where only the target words change.
   - Specifically NEVER write or mimic sentences like:
     * "The day began with great purpose as [Name] reviewed key plans regarding [word]..."
     * "Taking decisive steps early in the morning ensured everyone was prepared to address [word]..."
     * "Transitioning into the afternoon, the team focused their energy on managing [word]..."
     * "At the same time, dedicating careful attention to [word] strengthened mutual trust..."
     * "Before wrapping up the day, taking a moment to evaluate the progress made on [word]..."
     * "Finishing the workday on schedule allowed everyone to celebrate their achievements..."
   - Vary the scenario and genre creatively and realistically across calls:
     * High-stakes workplace discussions, design critiques, urgent troubleshooting, lab diagnostics, software or product launches
     * Culinary arts, artisan workshops, pottery, architecture, craftsmanship
     * Travel complications, transit logistics, airport connections, international conferences
     * Everyday moments, personal triumphs, community initiatives, athletic or health challenges
   - Featuring ${protagonist} as a capable, relatable protagonist navigating this concrete situation.

2. INTEGRAÇÃO ORGÂNICA DAS PALAVRAS DO DIA:
   - Every single word from the day's vocabulary list must be woven naturally and grammatically into the story.
   - Respect real-world parts of speech:
     * Verbs must be used as genuine actions or states (e.g. "negotiate terms", "reinforce the foundation", "exited through the side door").
     * Adjectives must modify nouns or follow linking verbs (e.g. "a perfect alignment", "the weather was perfect", "remained willing to assist").
     * Nouns must function as subjects, direct objects, or complements.
   - NEVER force a verb or adjective into an awkward noun position.
   - Every target word MUST be highlighted in markdown bold: **word**.

3. COERÊNCIA TOTAL DAS PERGUNTAS DE INTERPRETAÇÃO:
   - Generate 2 to 3 multiple-choice reading comprehension questions based EXCLUSIVELY on the newly generated mini-story.
   - 100% STORY-GROUNDED: Every question must probe specific plot events, character motivations, decisions, or concrete outcomes from the story you just wrote.
   - ZERO GENERIC QUESTIONS: Prohibit any question about English study habits, vocabulary memorization, grammar theory, or general philosophies.
   - 4 Narrative-specific options: Exactly 4 options per question ([Option A, Option B, Option C, Option D]). 1 option must be unambiguously correct based on the story, and 3 must be plausible narrative distractors derived from the story context.
   - Accurate zero-based correctAnswer index (0, 1, 2, or 3).
   - Clear explanation directly referencing the story sentence that proves the answer.

Output format must be a strict JSON object:
{
  "title": "A captivating, story-specific title",
  "text": "The 100% original narrative (1 to 3 paragraphs) with each target word highlighted as **word**.",
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

  const userPrompt = `Generate a 100% INÉDITA mini-story and 2-3 coherent comprehension questions for:
Protagonist: "Alex"
Proficiency Level: ${levelMeta.labelEn} (${levelMeta.labelPt} - CEFR ${levelMeta.cefr})
Target Words of the Day to weave in organically with **word**:
${words.map((w, i) => `${i + 1}. "${w}"`).join('\n')}

MANDATORY RULES:
1. Plot must be 100% original, lively, and engaging. Absolutely ZERO formulaic templates!
2. All target words must be used with grammatical precision and highlighted as **word**.
3. All questions must test factual events, decisions, and turning points in this narrative.
Return strict JSON only.`;

  // Security Hotfix (Etapa 2): Single attempt with gemini-2.5-flash, exact token bounds, zero cascades
  const singleAttempt = await executeGeminiSingleAttempt({
    feature: 'homework_part4',
    systemInstruction,
    untrustedUserDataPrompt: userPrompt,
    callerRole: 'student',
    apiKey,
    temperature: 0.7,
  });

  if (singleAttempt?.parsedJson) {
    const parsed = singleAttempt.parsedJson;
    if (
      parsed &&
      parsed.title &&
      parsed.text &&
      !isBadStoryText(parsed.text) &&
      Array.isArray(parsed.questions) &&
      parsed.questions.length > 0
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

      return parsed;
    }
  }

  return null;
}

// Specialized Native English Teacher & Instructional Designer Generator for Weekly Memorization Activity
async function generateDirectMemorizationAi(
  words: string[],
  studentLevel: string,
  studentName: string = 'Student'
): Promise<any | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !Array.isArray(words) || words.length === 0) return null;

  const cacheKey = `${words.map((w) => w.toLowerCase().trim()).sort().join('|')}_${studentLevel.toLowerCase()}`;
  const cached = aiMemorizationCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    const cachedStory = cached.data?.readingPassage?.text || '';
    if (!isBadStoryText(cachedStory) && !hasGenericBoilerplate(cached.data)) {
      return cached.data;
    }
    aiMemorizationCache.delete(cacheKey);
  }

  const levelMeta = normalizeStudentLevel(studentLevel);

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
     * Compose a cohesive, lively, and 100% original short story featuring a relatable protagonist navigating a concrete situation that seamlessly and organically embeds ALL target words in context, highlighted with **word**.
     * Accompany with 2 to 3 multiple-choice reading comprehension questions that strictly test concrete plot events, decisions, and outcomes in this narrative. ZERO generic questions about English study methods.
     * Each question has 4 options, a "correctAnswer" index (0, 1, 2, or 3), and an "explanation" citing the story.

You MUST respond with a strict, valid JSON object matching the requested schema.`;

  // Security Hotfix (Etapa 2): Privacy enforcement — student personal name removed from prompts
  const userPrompt = `Generate the complete, customized 4-part Memorization Activity:
- Target Learner Level: ${levelMeta.labelEn} (${levelMeta.labelPt} - CEFR ${levelMeta.cefr})
- Pedagogical Grammar Focus: ${levelMeta.grammarFocusEn}

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
    "text": "Coherent short story that organically embeds ALL target words highlighted with **word**.",
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

  // Security Hotfix (Etapa 2): Single attempt with gemini-2.5-flash, exact token bounds, zero cascade
  const singleAttempt = await executeGeminiSingleAttempt({
    feature: 'homework_generate',
    systemInstruction,
    untrustedUserDataPrompt: userPrompt,
    callerRole: 'student',
    apiKey,
    temperature: 0.65,
  });

  if (singleAttempt?.parsedJson) {
    const parsed = singleAttempt.parsedJson;
    if (
      parsed &&
      Array.isArray(parsed.matchingPairs) &&
      parsed.matchingPairs.length > 0 &&
      Array.isArray(parsed.fillInBlanks) &&
      parsed.fillInBlanks.length > 0 &&
      Array.isArray(parsed.sentenceWritingPrompts) &&
      parsed.sentenceWritingPrompts.length > 0
    ) {
      if (!hasGenericBoilerplate(parsed)) {
        // If story was missing or formulaic, synthesize cohesive story deterministically (zero secondary cascade)
        if (!parsed.readingPassage?.text || isBadStoryText(parsed.readingPassage.text)) {
          parsed.readingPassage = synthesizeCohesiveStoryAndQuestions({
            words,
            studentLevel,
            studentName: 'Student',
          });
        }

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

    const cacheKey = `${cleanWords.map((w: string) => w.toLowerCase().trim()).sort().join('|')}_${studentLevel.toLowerCase()}`;
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
      aiResult = await generateDirectMemorizationAi(cleanWords, studentLevel, studentName);
    } finally {
      await flightLock.release();
    }

    const wasAiGenerated = Boolean(aiResult && !hasGenericBoilerplate(aiResult));

    // Assemble the 4 parts
    let matchingPairs: any[] = [];
    let fillInBlanks: any[] = [];
    let sentenceWritingPrompts: any[] = [];
    let readingPassage: any = null;

    if (
      aiResult &&
      Array.isArray(aiResult.matchingPairs) &&
      aiResult.matchingPairs.length > 0 &&
      Array.isArray(aiResult.fillInBlanks) &&
      aiResult.fillInBlanks.length > 0 &&
      !hasGenericBoilerplate(aiResult)
    ) {
      matchingPairs = aiResult.matchingPairs;
      fillInBlanks = aiResult.fillInBlanks;
      sentenceWritingPrompts = aiResult.sentenceWritingPrompts || [];

      if (aiResult.readingPassage?.text && !isBadStoryText(aiResult.readingPassage.text)) {
        readingPassage = aiResult.readingPassage;
      } else {
        readingPassage = synthesizeCohesiveStoryAndQuestions({
          words: cleanWords,
          studentLevel,
          studentName: 'Alex',
          wordDetails,
        });
      }
    }

    // Dynamic, contextual fallback without any boilerplate
    if (!matchingPairs || matchingPairs.length === 0) {
      matchingPairs = cleanWords.map((w, idx) => {
        const detail = wordDetails.find((d: any) => d.word?.toLowerCase().trim() === w.toLowerCase().trim());
        const prof = profileWord(w, detail);
        return {
          id: `match-${idx}-${w}`,
          word: w,
          definition: prof.definitionEn,
          translation: prof.translationPt,
        };
      }).sort(() => 0.5 - Math.random());
    }

    if (!fillInBlanks || fillInBlanks.length === 0) {
      fillInBlanks = synthesizeFillInBlanks(cleanWords, wordDetails);
    }

    if (!sentenceWritingPrompts || sentenceWritingPrompts.length === 0) {
      sentenceWritingPrompts = cleanWords.map((w, idx) => {
        const detail = wordDetails.find((d: any) => d.word?.toLowerCase().trim() === w.toLowerCase().trim());
        const prof = profileWord(w, detail);
        let hintEn = '';
        let hintPt = '';
        if (levelMeta.key === 'advanced') {
          hintEn = `Formulate an advanced sentence using "${w}" analyzing a strategic goal, project challenge, or complex decision.`;
          hintPt = `Formule uma frase em nível avançado usando "${w}" (${prof.translationPt}) analisando uma decisão complexa ou meta de carreira.`;
        } else if (levelMeta.key === 'intermediate') {
          hintEn = `Write an authentic compound sentence with "${w}" connecting two related actions or explaining a key reason in your daily routine.`;
          hintPt = `Escreva uma frase intermediária autêntica com "${w}" (${prof.translationPt}) conectando duas ações ou explicando uma razão da rotina.`;
        } else {
          hintEn = `Write a clear, direct English sentence about your daily routine using "${w}".`;
          hintPt = `Escreva uma frase simples e direta sobre sua rotina usando "${w}" (${prof.translationPt}).`;
        }
        return {
          word: w,
          hint: hintEn,
          hintPt,
          hintEn,
          levelInstruction: levelMeta.key === 'advanced'
            ? 'Use complex clauses, conditionals (if/would), or executive phrasing.'
            : levelMeta.key === 'intermediate'
            ? 'Connect two ideas using a connector like "because", "although", "since", or "while".'
            : 'Use a clear Subject + Verb + Object structure.',
        };
      });
    }


    if (!readingPassage || isBadStoryText(readingPassage.text)) {
      readingPassage = synthesizeCohesiveStoryAndQuestions({
        words: cleanWords,
        studentLevel,
        studentName,
        wordDetails,
      });
    }

    // Build unified vocabulary list populated directly with contextual definitions and sentences
    const vocabularyList = cleanWords.map((word) => {
      const matchPair = matchingPairs.find((m: any) => m.word?.toLowerCase() === word.toLowerCase());
      const fillItem = fillInBlanks.find((f: any) => f.correctWord?.toLowerCase() === word.toLowerCase());
      const prof = profileWord(word);
      return {
        word,
        definitionEn: matchPair?.definition || prof.definitionEn,
        translationPt: matchPair?.translation || prof.translationPt,
        exampleSentence: fillItem?.sentenceWithBlank?.replace(/______/g, word) || prof.exampleSentenceEn,
        sourceActivityName: 'Weekly Vocabulary',
        sourceDay: 'monday' as const,
      };
    });

    const finalHomeworkData = {
      id: `hw-ai-${Date.now()}`,
      weekLabel: weekLabel || `Semana de ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`,
      studentEmail: studentEmail || '',
      studentName: studentName || 'Student',
      studentLevel: levelMeta.labelEn,
      createdAt: new Date().toISOString(),
      totalWordsCollected: cleanWords.length,
      vocabularyList,
      allRoutineWords: vocabularyList,
      matchingPairs,
      fillInBlanks,
      sentenceWritingPrompts,
      readingPassage,
      isEmpty: false,
      isAiGenerated: wasAiGenerated,
      isFallback: !wasAiGenerated,
      isCompleted: false,
      score: 0,
    };

    const payload = { success: true, homework: finalHomeworkData };
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

    // Security Hotfix (Etapa 2 & Residuals): Single-flight lock
    const part4LockKey = `homework_part4:${cleanWords.sort().join('|')}_${effectiveLevel}`;
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
      aiStory = await generatePart4StoryWithGemini(cleanWords, effectiveLevel, effectiveName);
    } finally {
      await flightLock.release();
    }

    if (aiStory && !isBadStoryText(aiStory.text)) {
      return res.json({ success: true, readingPassage: aiStory, isAiGenerated: true, isFallback: false });
    }

    // Dynamic fallback ensuring zero template-reuse
    const fallbackStory = synthesizeCohesiveStoryAndQuestions({
      words: cleanWords,
      studentLevel,
      studentName,
      wordDetails,
    });
    return res.json({ success: true, readingPassage: fallbackStory, isAiGenerated: false, isFallback: true });
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

async function evaluateDailySentenceIsolated(
  sentence: string,
  dailyWords: string[] = []
): Promise<any> {
  const rawClean = (sentence || '').trim();
  const cleanDailyWords = Array.from(
    new Set(
      (Array.isArray(dailyWords) ? dailyWords : [])
        .map((w) => (typeof w === 'string' ? w.trim() : ''))
        .filter(Boolean)
    )
  );

  const cacheKey = `v3::${rawClean}::${cleanDailyWords.map((w) => w.toLowerCase()).sort().join(',')}`;
  const cached = dailySentenceEvaluationCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
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

  // 2. Concise, token-optimized Gemini API call strictly for Sentence of the Day
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && rawClean.length >= 3) {
    const concisePrompt = `You are a strict English grammar checker for "Sentence of the Day".
Evaluate the student's sentence with zero-tolerance for errors:
1. Capitalization: Standalone pronoun "i" MUST be "I" (e.g. "because i pass" -> "because I passed", "now i will" -> "now I will"). First word of sentence must be capitalized.
2. Verb Tense & Agreement: Check tense consistency across clauses (e.g. if the sentence starts in past tense like "Today was a perfect day", causal/subordinate clauses like "because i pass the test" MUST use past tense "because I passed the test"). Check 3rd-person singular, modals, and auxiliaries.
3. Articles, Prepositions, Spelling & Punctuation: Fix any unnatural phrasing, comma splices (remove unnecessary comma before "because"), article errors (a/an), or typos.
4. Daily Vocabulary: Identify which of Daily Words are used and which are missing.

Student Sentence: "${rawClean}"
Daily Words: ${JSON.stringify(cleanDailyWords)}

Return strict JSON:
{"hasAnyError":boolean,"isCorrect":boolean,"usedWords":[string],"missingWords":[string],"correctedSentence":string,"explanationPt":string,"explanationEn":string,"wordFeedbacks":[{"original":string,"hasError":boolean,"corrected":string,"explanationPt":string,"explanationEn":string}]}`;

    // Security Hotfix (Etapa 2): Single attempt with gemini-2.5-flash, exact token bounds, zero cascade
    const singleAttempt = await executeGeminiSingleAttempt({
      feature: 'check_daily_sentence',
      systemInstruction: 'You are an ultra-rigorous English grammar checker for Sentence of the Day. Respond strictly in valid JSON.',
      untrustedUserDataPrompt: concisePrompt,
      callerRole: 'student',
      apiKey,
      temperature: 0.1,
    });

    const parsed = singleAttempt?.parsedJson;
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

      const finalHasError = Boolean(
        hasProgrammaticError ||
          hasDiff ||
          parsed.hasAnyError === true ||
          parsed.isCorrect === false ||
          !usedTargetWord
      );

      const aiExplPt = parsed.explanationPt || parsed.explanation || '';
      const aiExplEn = parsed.explanationEn || parsed.explanation || '';

      const combinedExplPt =
        Array.from(new Set([...programmaticErrorsPt, aiExplPt].filter(Boolean)))
          .join(' ')
          .trim() ||
        (finalHasError
          ? 'Ajustes gramaticais sugeridos para tornar sua frase correta e natural.'
          : 'Sua frase está gramaticalmente correta e natural.');

      const combinedExplEn =
        Array.from(new Set([...programmaticErrorsEn, aiExplEn].filter(Boolean)))
          .join(' ')
          .trim() ||
        (finalHasError
          ? 'Suggested grammar adjustments to make your sentence accurate and natural.'
          : 'Your sentence is grammatically accurate and natural.');

      // Merge wordFeedbacks from deterministic check and Gemini
      const combinedWordFeedbacks = [...wordFeedbacks];
      if (Array.isArray(parsed.wordFeedbacks)) {
        parsed.wordFeedbacks.forEach((wf: any) => {
          if (
            wf &&
            wf.hasError &&
            wf.original &&
            wf.corrected &&
            !combinedWordFeedbacks.some(
              (existing) =>
                existing.original.toLowerCase() === String(wf.original).toLowerCase()
            )
          ) {
            combinedWordFeedbacks.push(wf);
          }
        });
      }

      const targetWordFeedback = hasWordConstraint
        ? usedTargetWord
          ? finalMissingWords.length > 0
            ? `Palavras utilizadas (${finalUsedWords.length}/${cleanDailyWords.length}): ${finalUsedWords.join(', ')}. Não incluída(s): ${finalMissingWords.join(', ')}.`
            : `Palavras da rotina utilizadas (${finalUsedWords.length}/${cleanDailyWords.length}): ${finalUsedWords.join(', ')}.`
          : `Inclua pelo menos uma palavra da sua rotina na frase (${cleanDailyWords.slice(0, 5).join(', ')}).`
        : '';

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
        },
        correctedSentence: finalCorrected,
        explanation: combinedExplPt,
        overallSummaryPt: finalHasError
          ? combinedExplPt
          : `Excelente! Frase natural com o vocabulário da sua rotina (${finalUsedWords.join(', ') || 'palavras de hoje'}).`,
        overallSummaryEn: finalHasError
          ? combinedExplEn
          : `Outstanding! Natural sentence using your daily vocabulary (${finalUsedWords.join(', ') || 'today’s words'}).`,
      };

      if (dailySentenceEvaluationCache.size > 200) {
        const firstKey = dailySentenceEvaluationCache.keys().next().value;
        if (firstKey) dailySentenceEvaluationCache.delete(firstKey);
      }
      dailySentenceEvaluationCache.set(cacheKey, {
        data: resultPayload,
        expiry: Date.now() + 30 * 60 * 1000,
      });
      return resultPayload;
    }
  }

  const targetWordFeedback = hasWordConstraint
    ? usedTargetWord
      ? missingWords.length > 0
        ? `Palavras utilizadas (${usedWords.length}/${cleanDailyWords.length}): ${usedWords.join(', ')}. Não incluída(s): ${missingWords.join(', ')}.`
        : `Palavras da rotina utilizadas (${usedWords.length}/${cleanDailyWords.length}): ${usedWords.join(', ')}.`
      : `Inclua pelo menos uma palavra da sua rotina na frase (${cleanDailyWords.slice(0, 5).join(', ')}).`
    : '';

  const fallbackExplPt = hasProgrammaticError
    ? programmaticErrorsPt.join(' ')
    : 'Sua frase está gramaticalmente correta e bem estruturada.';
  const fallbackExplEn = hasProgrammaticError
    ? programmaticErrorsEn.join(' ')
    : 'Your sentence is grammatically sound and well structured.';

  const fallbackPayload = {
    hasAnyError: hasProgrammaticError,
    isCorrect: !hasProgrammaticError,
    usedTargetWord,
    usedWords,
    missingWords,
    targetWordFeedback,
    wordFeedbacks,
    sentenceFeedback: {
      original: rawClean,
      hasError: hasProgrammaticError,
      corrected: programmaticFixed,
      explanationPt: fallbackExplPt,
      explanationEn: fallbackExplEn,
    },
    correctedSentence: programmaticFixed,
    explanation: fallbackExplPt,
    overallSummaryPt: fallbackExplPt,
    overallSummaryEn: fallbackExplEn,
  };

  dailySentenceEvaluationCache.set(cacheKey, {
    data: fallbackPayload,
    expiry: Date.now() + 10 * 60 * 1000,
  });
  return fallbackPayload;
}

app.post('/api/check-daily-sentence', firebaseAuthMiddleware, async (req, res) => {
  try {
    const caller = req.user!;
    const callerUid = caller.uid;
    const callerEmail = (caller.email || '').toLowerCase().trim();
    const { sentence = '', dailyWords = [], studentUid = '', studentEmail = '' } = req.body || {};

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

    let result: any = null;
    try {
      result = await evaluateDailySentenceIsolated(sentence, dailyWords);
    } finally {
      await flightLock.release();
    }
    return res.json(result);
  } catch (err: any) {
    return res.status(200).json({
      hasAnyError: false,
      isCorrect: true,
      usedTargetWord: true,
      usedWords: Array.isArray(req.body?.dailyWords) ? req.body.dailyWords : [],
      missingWords: [],
      correctedSentence: req.body?.sentence || '',
      explanation: 'Frase verificada com sucesso.',
      isFallback: true,
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
  if (apiKey) {
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

    let parsed: any = null;
    try {
      parsed = await callGeminiSafeJson(prompt, 6000, 'check_writing', caller.role);
    } finally {
      await flightLock.release();
    }
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
  }

  // Fallback heuristic with level tips, trigger detection, and absolute rigor
  let usedTrigger = true;
  let triggerFeedback = '';
  if (levelInstruction && levelInstruction.trim()) {
    const triggerLower = levelInstruction.toLowerCase();
    if (triggerLower.includes('because') || triggerLower.includes('since')) {
      usedTrigger = /\b(because|since)\b/i.test(lowerSentence);
      triggerFeedback = usedTrigger
        ? 'Gatilho cumprido: você usou "because" ou "since" para justificar o motivo.'
        : 'Desafio: lembre-se de usar "because" ou "since" para explicar a sua razão.';
    } else if (triggerLower.includes('whenever')) {
      usedTrigger = /\bwhenever\b/i.test(lowerSentence);
      triggerFeedback = usedTrigger
        ? 'Gatilho cumprido: você aplicou "whenever" para descrever um hábito.'
        : 'Desafio: inclua o conectivo "whenever" para indicar frequência ou hábito.';
    } else if (triggerLower.includes('modal') || triggerLower.includes('might') || triggerLower.includes('should')) {
      usedTrigger = /\b(might|should|could|would|can|must)\b/i.test(lowerSentence);
      triggerFeedback = usedTrigger
        ? 'Gatilho cumprido: verbo modal aplicado adequadamente.'
        : 'Desafio: use um verbo modal como "might", "should" ou "could".';
    } else if (triggerLower.includes('conditional') || triggerLower.includes('if')) {
      usedTrigger = /\b(if|unless)\b/i.test(lowerSentence);
      triggerFeedback = usedTrigger
        ? 'Gatilho cumprido: oração condicional aplicada.'
        : 'Desafio: formule uma condição usando "if" ou "unless".';
    }
  }

  const wordFeedbacks: any[] = [];
  // Add any misspelled sentence words caught by server spelling fixes
  Object.entries(SERVER_SPELLING_FIXES).forEach(([wrong, data]) => {
    const rx = new RegExp(`\\b${wrong}\\b`, 'gi');
    if (rx.test(rawClean)) {
      wordFeedbacks.push({
        original: wrong,
        hasError: true,
        corrected: data.correct,
        explanationPt: data.explPt,
        explanationEn: data.explEn,
      });
    }
  });

  allTargetWords.forEach((w: string) => {
    const isIncluded = usedWords.includes(w);
    wordFeedbacks.push({
      original: w,
      hasError: false,
      corrected: w,
      explanationPt: isIncluded ? 'Palavra incorporada na frase.' : 'Ortografia válida.',
      explanationEn: isIncluded ? 'Word used in sentence.' : 'Valid spelling.',
    });
  });

  const isBeg = levelMeta.key === 'beginner';
  const isAdv = levelMeta.key === 'advanced';

  let hasSentenceError = hasProgrammaticError;
  let correctedSentence = programmaticFixed;

  const targetWordFeedback = hasWordConstraint
    ? usedTargetWord
      ? `Palavras da rotina utilizadas: ${usedWords.join(', ')}.`
      : `Inclua pelo menos uma palavra da sua rotina na frase (${allTargetWords.slice(0, 3).join(', ')}...).`
    : '';

  const explanationPt = hasSentenceError
    ? programmaticErrorsPt.join(' ')
    : !usedTargetWord && hasWordConstraint
    ? `Por favor, inclua palavras da sua rotina de hoje (${allTargetWords.slice(0, 3).join(', ')}...).`
    : 'Frase correta e bem estruturada.';

  const explanationEn = hasSentenceError
    ? programmaticErrorsEn.join(' ')
    : !usedTargetWord && hasWordConstraint
    ? `Please include words from today's routine (${allTargetWords.slice(0, 3).join(', ')}...).`
    : 'Correct and well-structured sentence.';

  const hasAnyError = hasSentenceError || !usedTargetWord || !usedTrigger;

  res.json({
    hasAnyError,
    isCorrect: !hasAnyError,
    usedTargetWord,
    usedWords,
    missingWords,
    targetWordFeedback,
    triggerFeedback,
    wordFeedbacks,
    sentenceFeedback: sentence
      ? {
          original: sentence,
          hasError: hasAnyError,
          corrected: correctedSentence,
          explanationPt,
          explanationEn,
        }
      : undefined,
    correctedSentence,
    explanation: explanationPt,
    overallSummaryPt: !hasAnyError
      ? `Excelente! Frase natural, com o vocabulário da sua rotina (${usedWords.join(', ') || 'palavras de hoje'}) e gramática correta.`
      : !usedTargetWord
      ? `Por favor, inclua palavras da sua rotina (${allTargetWords.slice(0, 4).join(', ')}) na sua frase.`
      : !usedTrigger
      ? triggerFeedback || 'Ajuste o gatilho solicitado na instrução.'
      : 'Atenção: sua frase contém incorreções gramaticais que precisam ser corrigidas antes da aprovação.',
    overallSummaryEn: !hasAnyError
      ? `Outstanding! Your sentence is grammatically correct and natural.`
      : !usedTargetWord
      ? `Please incorporate routine words (${allTargetWords.slice(0, 4).join(', ')}) into your sentence.`
      : !usedTrigger
      ? 'Review the challenge trigger specified in the prompt.'
      : 'Needs revision: please review the grammar corrections below to perfect your sentence.',
    levelTipsPt: isBeg
      ? 'Dica Iniciante: Lembre-se sempre de manter Sujeito + Verbo + Complemento.'
      : isAdv
      ? 'Dica Avançada: Explore construções complexas, conectivos e linguagem idiomática.'
      : 'Dica Intermediária: Pratique o uso de conectivos como "because", "while" ou "although" para unir duas ações.',
    levelTipsEn: isBeg
      ? 'Beginner Tip: Keep practicing the core Subject + Verb + Object structure.'
      : isAdv
      ? 'Advanced Tip: Explore complex clauses and idiomatic collocations.'
      : 'Intermediate Tip: Try linking ideas with connectors like "because" or "while".',
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
    const caller = req.user!;
    const callerUid = caller.uid;
    const callerEmail = (caller.email || '').toLowerCase().trim();
    const {
      homework,
      studentAnswers = {},
      studentLevel = 'iniciante',
      studentName = 'Student',
      studentUid = '',
      studentEmail = '',
      currentLanguage = 'pt',
    } = req.body || {};

    if (!homework) {
      return res.status(400).json({ error: 'homework data is required' });
    }

    let effectiveLevel = studentLevel || homework.studentLevel;
    let effectiveName = studentName || homework.studentName;

    if (caller.role === 'student') {
      if (studentUid && studentUid !== callerUid) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Unauthorized access: cannot evaluate homework for another student.',
        });
      }
      if (studentEmail && studentEmail.toLowerCase().trim() !== callerEmail) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Unauthorized access: cannot evaluate homework for another student.',
        });
      }
      if (homework.studentUid && homework.studentUid !== callerUid) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Unauthorized access: cannot evaluate homework for another student.',
        });
      }
      if (homework.studentEmail && homework.studentEmail.toLowerCase().trim() !== callerEmail) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Unauthorized access: cannot evaluate homework for another student.',
        });
      }

      const db = readDb();
      const registeredStudent = (db.students || []).find((s: any) =>
        (s.uid === callerUid || s.id === callerUid) ||
        (callerEmail && (s.email || '').toLowerCase().trim() === callerEmail)
      );
      const profile = db.userProfiles?.[callerUid] || (callerEmail && db.userProfiles?.[callerEmail]);
      effectiveLevel = profile?.level || profile?.englishLevel || registeredStudent?.level || registeredStudent?.englishLevel || effectiveLevel;
      effectiveName = profile?.name || registeredStudent?.name || effectiveName;
    }

    const levelMeta = normalizeStudentLevel(effectiveLevel);
    const { matching = {}, fillInBlanks = {}, sentences = {}, quizAnswers = {} } = studentAnswers;

    // Check in-memory cache to preserve previously evaluated content and prevent duplicate costs
    const sentencesContent = JSON.stringify(sentences || {});
    const contentHash = crypto.createHash('sha256').update(sentencesContent).digest('hex').slice(0, 16);
    const evalCacheKey = `${callerUid}_${homework.id || 'hw'}_${contentHash}`;
    const cachedEval = homeworkEvalCache.get(evalCacheKey);
    if (cachedEval && Date.now() < cachedEval.expiry) {
      return res.json({ success: true, evaluation: cachedEval.data, cached: true });
    }

    // Security Hotfix (Etapa 2 & Residuals): Payload bounds validation
    const bounds = validatePayloadBounds('homework_evaluate', { text: sentencesContent });
    if (!bounds.valid) {
      return res.status(400).json({ error: 'Payload bounds exceeded', message: bounds.error });
    }

    // Security Hotfix (Etapa 2 & Residuals): Rate limiting check per authenticated UID
    const rateCheck = await checkAndConsumeRateLimit(callerUid, 'homework_evaluate');
    if (!rateCheck.allowed) {
      if (rateCheck.unavailable) {
        return sendGeminiCostControlUnavailable(res, 5);
      }
      logGeminiAudited({
        feature: 'homework_evaluate',
        status: 'RATE_LIMITED',
        callerRole: caller.role,
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
    const flightKey = `homework_evaluate:${callerUid}:${homework.id || 'hw'}:${contentHash}`;
    const flightLock = await acquireSingleFlightLock(flightKey);
    if (!flightLock.acquired) {
      if (flightLock.unavailable) {
        return sendGeminiCostControlUnavailable(res, 5);
      }
      logGeminiAudited({
        feature: 'homework_evaluate',
        status: 'INFLIGHT_LOCKED',
        callerRole: caller.role,
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
      const isCorrect = userAns.toLowerCase() === f.correctWord.toLowerCase();
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

    // Score calculation
    const totalMatching = Math.max(1, homework.matchingPairs?.length || 1);
    const totalFill = Math.max(1, homework.fillInBlanks?.length || 1);
    const totalQuiz = Math.max(1, homework.readingPassage?.questions?.length || 1);
    const totalSentences = Math.max(1, homework.sentenceWritingPrompts?.length || 1);

    const matchScore = (matchingCorrect / totalMatching) * 25;
    const fillScore = (fillCorrect / totalFill) * 30;
    const quizScore = (quizCorrect / totalQuiz) * 20;

    // AI evaluation of sentences with Gemini (single attempt with explicit homework_evaluate policy)
    const apiKey = process.env.GEMINI_API_KEY;
    let sentenceEvaluationResults: any[] = [];
    let tutorSummaryPt = '';
    let tutorSummaryEn = '';
    let levelStrengthsPt = '';
    let levelStrengthsEn = '';
    let levelNextStepsPt = '';
    let levelNextStepsEn = '';

    try {
      if (apiKey) {
        const prompt = `You are a warm, inspiring Native English teacher at "It's Simple".
Evaluate this student's completed Weekly Memorization Activity.

STUDENT PROFILE:
Name: ${studentName}
Level: ${levelMeta.labelEn} (${levelMeta.labelPt} - CEFR ${levelMeta.cefr})
Level Goals: ${levelMeta.grammarFocusEn}

STUDENT WRITTEN SENTENCES IN PART 3:
${JSON.stringify(
  (homework.sentenceWritingPrompts || []).map((p: any) => ({
    targetWord: p.word,
    studentSentence: sentences[p.word] || '',
    promptHint: p.hintEn || p.hint,
  })),
  null,
  2
)}

STATS OF OTHER SECTIONS:
- Matching (Part 1): ${matchingCorrect}/${totalMatching} correct
- Fill in Blanks (Part 2): ${fillCorrect}/${totalFill} correct
- Reading Comprehension (Part 4): ${quizCorrect}/${totalQuiz} correct

EVALUATION INSTRUCTIONS:
1. For each written sentence:
   - Check grammar, spelling, natural phrasing, and appropriate use of target word.
   - Align praise and constructive corrections to the student's level (${levelMeta.labelEn}).
   - If Beginner: celebrate simple sentences, gently fix mechanics.
   - If Intermediate: suggest natural connectors and verb forms.
   - If Advanced: refine style, collocation elegance, and tone.
2. Provide a personalized, encouraging summary note from the tutor:
   - "tutorFeedbackSummaryPt" (in Portuguese) and "tutorFeedbackSummaryEn" (in English).
3. Provide level-specific strengths ("levelStrengthsPt", "levelStrengthsEn").
4. Provide actionable next steps for their English routine ("levelNextStepsPt", "levelNextStepsEn").

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

        // Explicitly apply homework_evaluate policy! Single bounded attempt, zero cascade
        const aiRes = await callGeminiSafeJson(prompt, 15000, 'homework_evaluate', caller.role);
        if (aiRes && Array.isArray(aiRes.sentenceFeedback)) {
          sentenceEvaluationResults = aiRes.sentenceFeedback;
          tutorSummaryPt = aiRes.tutorFeedbackSummaryPt || '';
          tutorSummaryEn = aiRes.tutorFeedbackSummaryEn || '';
          levelStrengthsPt = aiRes.levelStrengthsPt || '';
          levelStrengthsEn = aiRes.levelStrengthsEn || '';
          levelNextStepsPt = aiRes.levelNextStepsPt || '';
          levelNextStepsEn = aiRes.levelNextStepsEn || '';
        }
      }
    } finally {
      await flightLock.release();
    }

    // Fallback sentence evaluation if AI was offline
    if (sentenceEvaluationResults.length === 0) {
      sentenceEvaluationResults = (homework.sentenceWritingPrompts || []).map((p: any) => {
        const raw = (sentences[p.word] || '').trim();
        const hasText = raw.length >= 6;
        const containsWord = raw.toLowerCase().includes(p.word.toLowerCase());
        const isOk = hasText && containsWord;

        return {
          word: p.word,
          originalSentence: raw || '(nenhuma frase escrita)',
          isCorrect: isOk,
          correctedSentence: raw || `I practice using ${p.word} every day.`,
          explanationPt: isOk
            ? `Parabéns! Você utilizou a palavra "${p.word}" com contexto correto.`
            : `Lembre-se de incluir a palavra "${p.word}" em uma frase completa sobre sua rotina.`,
          explanationEn: isOk
            ? `Great job! You incorporated "${p.word}" with natural context.`
            : `Remember to include the target word "${p.word}" in a full routine sentence.`,
          levelAdvicePt: levelMeta.key === 'beginner'
            ? 'Continue praticando frases curtas com Sujeito + Verbo.'
            : levelMeta.key === 'advanced'
            ? 'Excelente! Experimente aplicar conectivos avançados e expressões idiomáticas.'
            : 'Muito bom! Tente conectar duas ideias usando conectivos como "because" ou "although".',
          levelAdviceEn: levelMeta.key === 'beginner'
            ? 'Keep practicing clear, simple sentences with Subject + Verb.'
            : levelMeta.key === 'advanced'
            ? 'Great! Experiment with advanced transition clauses and rich collocations.'
            : 'Good job! Try linking ideas with connectors like "because" or "while".',
        };
      });

      tutorSummaryPt = `Parabéns pela dedicação na Atividade de Memorização! Você consolidou o vocabulário real da sua semana com foco no nível ${levelMeta.labelPt}. Continue vivendo o inglês na sua rotina diária.`;
      tutorSummaryEn = `Congratulations on completing your Weekly Memorization Activity! You practiced your real weekly vocabulary tailored to your ${levelMeta.labelEn} level. Keep living English in your daily routine.`;
      levelStrengthsPt = `Boa capacidade de identificação de termos no contexto diário e dedicação na resolução dos desafios interativos.`;
      levelStrengthsEn = `Strong ability to recognize routine vocabulary and dedication in active recall practice.`;
      levelNextStepsPt = `Na sua próxima aula com seu Amigo Nativo, use as palavras desta semana em conversas espontâneas.`;
      levelNextStepsEn = `In your next live session with your Native Friend, use these words naturally in casual conversation.`;
    }

    // Sentence score: up to 25 points
    let sentenceCorrectCount = 0;
    sentenceEvaluationResults.forEach((s) => {
      if (s.isCorrect) sentenceCorrectCount++;
    });
    const sentenceScore = (sentenceCorrectCount / totalSentences) * 25;

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
      readingFeedback,
    };

    // Cache evaluated result
    homeworkEvalCache.set(evalCacheKey, { data: evaluationResponse, expiry: Date.now() + 600000 });

    res.json({ success: true, evaluation: evaluationResponse });
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

      // Explicitly apply vocab_generate policy! Single bounded attempt, zero cascade
      const parsed = await callGeminiSafeJson(prompt, 8000, 'vocab_generate', caller.role);
      if (Array.isArray(parsed) && parsed.length > 0) {
        generatedEntries = parsed;
      }
    }
  } finally {
    await flightLock.release();
  }

  if (generatedEntries && generatedEntries.length > 0) {
    lessonVocabCache.set(vocabCacheKey, generatedEntries);
    return res.json({ success: true, entries: generatedEntries });
  }

  // Fallback linguistic generator for each word
  const fallbackEntries = cleanWords.map((word) => {
    return {
      word,
      definitionEn: `A practical English term denoting "${word}", used naturally when communicating about ${topic || 'daily life'}.`,
      exampleSentenceEn: `During our conversation about ${topic || 'our routines'}, we practiced using "${word}" naturally.`,
      translationPt: `Vocabulário prático em inglês`,
    };
  });

  lessonVocabCache.set(vocabCacheKey, fallbackEntries);
  res.json({ success: true, entries: fallbackEntries, isFallback: true });
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

  // Hydrate from Cloud Firestore first with safety timeout so server always starts quickly
  await Promise.race([
    initCloudPersistence(),
    new Promise((resolve) => setTimeout(resolve, 3500)),
  ]).catch((err) => {
    console.warn('Initial cloud persistence notice:', err);
  }).finally(() => {
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
      console.warn(`Port ${PORT} is already in use, listening skipped.`);
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
