import { clearAllLocalPersistenceCaches } from './studentPersistence';
import { clearDictionaryMemoryCache } from './dictionaryService';
import { clearDirectMessagesMemoryCache } from './directMessages';
import { clearRoutineSyncMemoryCache } from './routineSync';
import { clearDailySentenceClientCache } from './writingChecker';
import { clearSpotifyMemoryCaches } from './spotify';
import { clearAuthClientMemoryCache } from './auth';
import { clearNativeFriendsNotesModalCache } from '../components/NativeFriendsNotesModal';

export interface SessionCacheCleanupOptions {
  preserveFirebaseAuth?: boolean;
  clearSessionStorage?: boolean;
}

const LEGACY_LOCAL_STORAGE_EXACT_KEYS = new Set<string>([
  'currentUserAccount',
  'google_oauth_token',
]);

const LEGACY_LOCAL_STORAGE_PREFIXES = [
  'userProfiles',
  'tutorsList',
  'routinesByDay',
  'its_simple_',
  'studentVocabulary_',
  'weeklyChecks_',
  'student_',
  'teacher_',
];

const LEGACY_SESSION_STORAGE_EXACT_KEYS = new Set<string>([
  'its_simple_preselected_tutor_id',
  'google_oauth_token',
]);

const LEGACY_SESSION_STORAGE_PREFIXES = [
  'its_simple_',
  'student_',
  'teacher_',
];

function isFirebaseAuthStorageKey(key: string): boolean {
  return key.startsWith('firebase:') || key.includes('firebaseLocalStorage');
}

function shouldRemoveLocalStorageKey(key: string, preserveFirebaseAuth: boolean): boolean {
  if (!key) return false;
  if (preserveFirebaseAuth && isFirebaseAuthStorageKey(key)) {
    return false;
  }
  if (LEGACY_LOCAL_STORAGE_EXACT_KEYS.has(key)) {
    return true;
  }
  return LEGACY_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function shouldRemoveSessionStorageKey(key: string, preserveFirebaseAuth: boolean): boolean {
  if (!key) return false;
  if (preserveFirebaseAuth && isFirebaseAuthStorageKey(key)) {
    return false;
  }
  if (LEGACY_SESSION_STORAGE_EXACT_KEYS.has(key)) {
    return true;
  }
  return LEGACY_SESSION_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Purges legacy browser storage entries (localStorage and optionally sessionStorage)
 * while strictly preserving active Firebase Authentication persistence keys (`firebase:*`).
 */
export function purgeLegacyBrowserStorage(options: SessionCacheCleanupOptions = {}): void {
  if (typeof window === 'undefined') return;
  const preserveFirebaseAuth = options.preserveFirebaseAuth !== false;
  const clearSessionStorage = options.clearSessionStorage !== false;

  try {
    if (window.localStorage) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && shouldRemoveLocalStorageKey(key, preserveFirebaseAuth)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => {
        try {
          window.localStorage.removeItem(key);
        } catch {}
      });
    }
  } catch {}

  if (clearSessionStorage) {
    try {
      if (window.sessionStorage) {
        const sessionKeysToRemove: string[] = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          if (key && shouldRemoveSessionStorageKey(key, preserveFirebaseAuth)) {
            sessionKeysToRemove.push(key);
          }
        }
        sessionKeysToRemove.forEach((key) => {
          try {
            window.sessionStorage.removeItem(key);
          } catch {}
        });
      }
    } catch {}
  }
}

/**
 * Clears all client-side in-memory caches and legacy browser storage safely
 * on logout, account switch, or session invalidation without breaking Firebase Auth.
 */
export function clearAllClientSessionCaches(options: SessionCacheCleanupOptions = {}): void {
  const clearers = [
    clearAllLocalPersistenceCaches,
    clearDictionaryMemoryCache,
    clearDirectMessagesMemoryCache,
    clearRoutineSyncMemoryCache,
    clearDailySentenceClientCache,
    clearSpotifyMemoryCaches,
    clearAuthClientMemoryCache,
    clearNativeFriendsNotesModalCache,
  ];

  clearers.forEach((clearFn) => {
    try {
      clearFn();
    } catch {}
  });

  purgeLegacyBrowserStorage(options);
}
