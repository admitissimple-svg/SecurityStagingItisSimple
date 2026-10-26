import { DayOfWeek, EnglishLevel, StudentJournalEntry } from '../types';

/**
 * Utility helpers for Spotify URLs, Embeds, and Automated Level-Based Daily Listening Playlists.
 * HOTFIX SPOTIFY — SECURITY STAGING:
 * - Bearer token removed from frontend. All authentication and official playlist queries run on backend.
 * - Zero static/alternative song fallbacks.
 * - Strict Spotify Track ID identification.
 * - Individual sequential progression without jumping offsets on filtered lists.
 */

export type SpotifyContentType = 'podcast' | 'music' | 'episode' | 'track' | 'playlist' | 'show' | 'album';

export type NormalizedStudentLevel = 'beginner' | 'intermediate' | 'advanced';

export interface SpotifyDailyTrack {
  dayOfWeek: DayOfWeek;
  dayLabelPt: string;
  dayLabelEn: string;
  trackId: string;
  title: string;
  artist: string;
  url: string;
  embedUrl: string;
  imageUrl?: string;
  albumImages?: Array<{ url: string; height?: number; width?: number }>;
  teacherTipPt: string;
  teacherTipEn: string;
}

export interface SpotifyLevelPlaylistConfig {
  level: NormalizedStudentLevel;
  levelLabelPt: string;
  levelLabelEn: string;
  playlistId: string;
  playlistTitle: string;
  playlistUrl: string;
  embedPlaylistUrl: string;
  descriptionPt: string;
  descriptionEn: string;
  tracks: Record<DayOfWeek, SpotifyDailyTrack | null>;
  pool?: SpotifyDailyTrack[];
}

export const DAYS_SEQUENCE: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * Bearer token is permanently removed from the client bundle.
 * Authenticated queries are handled exclusively by the backend via environment variables.
 */
export const SPOTIFY_BEARER_TOKEN = '';
export const SPOTIFY_IT_IS_SIMPLE_TOKEN = '';

export const DAY_LABELS: Record<DayOfWeek, { pt: string; en: string }> = {
  monday: { pt: 'Segunda-feira', en: 'Monday' },
  tuesday: { pt: 'Terça-feira', en: 'Tuesday' },
  wednesday: { pt: 'Quarta-feira', en: 'Wednesday' },
  thursday: { pt: 'Quinta-feira', en: 'Thursday' },
  friday: { pt: 'Sexta-feira', en: 'Friday' },
  saturday: { pt: 'Sábado', en: 'Saturday' },
  sunday: { pt: 'Domingo', en: 'Sunday' },
};

/**
 * Official Spotify Playlist IDs by level:
 * - Beginner: 5MMU9H5oXDd7FCWr0gkzHE
 * - Intermediate: 34E52K1dEJO5CzZRPkIR4I
 * - Advanced: 6ScLXNefp8JFohezoJve2Z
 */
export const SPOTIFY_PLAYLIST_IDS: Record<NormalizedStudentLevel, string> = {
  beginner: '5MMU9H5oXDd7FCWr0gkzHE',
  intermediate: '34E52K1dEJO5CzZRPkIR4I',
  advanced: '6ScLXNefp8JFohezoJve2Z',
};

export const SPOTIFY_LEVEL_PLAYLISTS: Record<NormalizedStudentLevel, SpotifyLevelPlaylistConfig> = {
  beginner: {
    level: 'beginner',
    levelLabelPt: 'Iniciante',
    levelLabelEn: 'Beginner',
    playlistId: '5MMU9H5oXDd7FCWr0gkzHE',
    playlistTitle: "Beginner • It's simple",
    playlistUrl: 'https://open.spotify.com/playlist/5MMU9H5oXDd7FCWr0gkzHE',
    embedPlaylistUrl: 'https://open.spotify.com/embed/playlist/5MMU9H5oXDd7FCWr0gkzHE?utm_source=generator&theme=0',
    descriptionPt: "Playlist oficial da It's simple (Adm Itissimple) para Iniciantes: músicas com dicção clara, frases fundamentais e ritmo acolhedor.",
    descriptionEn: "Official It's simple playlist (Adm Itissimple) for Beginners: songs featuring clear diction, foundational phrasing, and accessible rhythm.",
    tracks: {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    },
    pool: [],
  },
  intermediate: {
    level: 'intermediate',
    levelLabelPt: 'Intermediário',
    levelLabelEn: 'Intermediate',
    playlistId: '34E52K1dEJO5CzZRPkIR4I',
    playlistTitle: "Intermediate • It's simple",
    playlistUrl: 'https://open.spotify.com/playlist/34E52K1dEJO5CzZRPkIR4I',
    embedPlaylistUrl: 'https://open.spotify.com/embed/playlist/34E52K1dEJO5CzZRPkIR4I?utm_source=generator&theme=0',
    descriptionPt: "Playlist oficial da It's simple (Adm Itissimple) para Intermediários: vocabulário do cotidiano, expressões idiomáticas e estruturas gramaticais variadas.",
    descriptionEn: "Official It's simple playlist (Adm Itissimple) for Intermediates: everyday vocabulary, idiomatic expressions, and diverse sentence structures.",
    tracks: {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    },
    pool: [],
  },
  advanced: {
    level: 'advanced',
    levelLabelPt: 'Avançado',
    levelLabelEn: 'Advanced',
    playlistId: '6ScLXNefp8JFohezoJve2Z',
    playlistTitle: "Advanced • It's simple",
    playlistUrl: 'https://open.spotify.com/playlist/6ScLXNefp8JFohezoJve2Z',
    embedPlaylistUrl: 'https://open.spotify.com/embed/playlist/6ScLXNefp8JFohezoJve2Z?utm_source=generator&theme=0',
    descriptionPt: "Playlist oficial da It's simple (Adm Itissimple) para Alunos Avançados: ritmo rápido, metáforas culturais, linguagem coloquial e rimas complexas.",
    descriptionEn: "Official It's simple playlist (Adm Itissimple) for Advanced Students: fast cadence, cultural metaphors, colloquial speech, and intricate phrasing.",
    tracks: {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    },
    pool: [],
  },
};

export const SPOTIFY_PLAYLISTS = SPOTIFY_LEVEL_PLAYLISTS;

export const SPOTIFY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes in memory

export interface SpotifyPlaylistCacheEntry {
  playlistId: string;
  tracks: SpotifyDailyTrack[];
  timestamp: number;
}

// In-memory runtime cache: zero localStorage reliance
const spotifyMemoryCache = new Map<string, SpotifyPlaylistCacheEntry>();

/**
 * Checks in-memory cache and purges legacy localStorage entries permanently.
 */
export function checkAndInvalidateSpotifyCache(): void {
  (['beginner', 'intermediate', 'advanced'] as NormalizedStudentLevel[]).forEach((lvl) => {
    const cached = spotifyMemoryCache.get(lvl);
    if (cached && cached.playlistId !== SPOTIFY_LEVEL_PLAYLISTS[lvl].playlistId) {
      spotifyMemoryCache.delete(lvl);
    }
  });

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      (['beginner', 'intermediate', 'advanced'] as NormalizedStudentLevel[]).forEach((lvl) => {
        localStorage.removeItem(`its_simple_spotify_playlist_v3_${lvl}`);
        localStorage.removeItem(`its_simple_spotify_playlist_v5_${lvl}`);
      });
    } catch {}
  }
}

/**
 * Retrieves cached playlist tracks from in-memory cache with strict playlistId validation.
 */
export function getCachedPlaylistTracks(rawLevel?: string | EnglishLevel | null): SpotifyDailyTrack[] | null {
  const norm = normalizeStudentLevel(rawLevel);
  const currentConfig = SPOTIFY_LEVEL_PLAYLISTS[norm];
  if (!currentConfig) return null;

  const cached = spotifyMemoryCache.get(norm);
  if (!cached) return null;

  if (cached.playlistId !== currentConfig.playlistId) {
    spotifyMemoryCache.delete(norm);
    return null;
  }

  if (Date.now() - cached.timestamp > SPOTIFY_CACHE_TTL_MS) {
    spotifyMemoryCache.delete(norm);
    return null;
  }

  return cached.tracks;
}

/**
 * Saves tracks in runtime in-memory cache.
 */
export function setCachedPlaylistTracks(
  rawLevel: string | EnglishLevel | null | undefined,
  playlistId: string,
  tracks: SpotifyDailyTrack[]
): void {
  const norm = normalizeStudentLevel(rawLevel);
  const entry: SpotifyPlaylistCacheEntry = {
    playlistId,
    tracks,
    timestamp: Date.now(),
  };
  spotifyMemoryCache.set(norm, entry);
}

/**
 * Explicitly clears/invalidates the Spotify playlist cache in memory.
 */
export function invalidateSpotifyPlaylistCache(level?: NormalizedStudentLevel | string): void {
  if (level) {
    const norm = normalizeStudentLevel(level);
    spotifyMemoryCache.delete(norm);
  } else {
    spotifyMemoryCache.clear();
  }
}

// Automatically purge outdated cache on module initialization in browser environment
if (typeof window !== 'undefined') {
  checkAndInvalidateSpotifyCache();
}

/**
 * Requests official playlist tracks.
 * HOTFIX SPOTIFY — PLAYLISTS OFICIAIS:
 * Individual song selection via Spotify Web API has been eliminated in favor of
 * direct access to the official Spotify playlists by level.
 */
export async function fetchPlaylistTracksFromSpotifyApi(
  _playlistId: string,
  _token?: string
): Promise<any> {
  return null;
}

/**
 * HOTFIX SPOTIFY — PLAYLISTS OFICIAIS:
 * Calls to Spotify Web API used exclusively to select songs in the daily listening activity
 * are permanently eliminated. The listening activity now accesses the official playlist directly.
 */
export async function fetchTracksForStudentLevel(
  _rawLevel?: string | EnglishLevel | null,
  _token?: string
): Promise<SpotifyDailyTrack[] | null> {
  return null;
}

/**
 * Normalizes any variation of student level into 'beginner' | 'intermediate' | 'advanced'
 */
export function normalizeStudentLevel(rawLevel?: string | EnglishLevel | null): NormalizedStudentLevel {
  if (!rawLevel) return 'beginner';
  const l = String(rawLevel).toLowerCase().trim();
  if (l.includes('inter') || l.includes('b1') || l.includes('b2')) return 'intermediate';
  if (l.includes('avan') || l.includes('adv') || l.includes('c1') || l.includes('c2')) return 'advanced';
  return 'beginner';
}

/**
 * Retrieves the Spotify playlist configuration mapped to the student's level
 */
export function getSpotifyPlaylistForLevel(rawLevel?: string | EnglishLevel | null): SpotifyLevelPlaylistConfig {
  const norm = normalizeStudentLevel(rawLevel);
  return SPOTIFY_LEVEL_PLAYLISTS[norm] || SPOTIFY_LEVEL_PLAYLISTS.beginner;
}

/**
 * Selects exactly one Spotify track for a student's study day, respecting:
 * 1. Assigned track preservation: If the student already has an assigned track for this day, returns it directly (preserves F5 and re-login).
 * 2. Weekly frequency (2x, 3x, 5x, 7x): Rest Days return null.
 * 3. Daily exclusivity: 1 song per active study day in sequential playlist order.
 * 4. Zero jumping offsets on filtered arrays.
 */
export function selectCurrentDaySpotifyTrack(params: {
  level?: string | EnglishLevel | null;
  selectedDay: DayOfWeek;
  activeStudyDays?: DayOfWeek[];
  weeklyCycle?: number;
  liveTracks?: SpotifyDailyTrack[] | null;
  studentJournal?: StudentJournalEntry[];
  consumedTrackIds?: string[];
  assignedTracks?: Array<{
    day: DayOfWeek | string;
    trackId?: string;
    trackUrl?: string;
    url?: string;
    title?: string;
    trackTitle?: string;
    artist?: string;
    artistOrHost?: string;
    embedUrl?: string;
    imageUrl?: string;
    teacherTipPt?: string;
    teacherTipEn?: string;
    albumImages?: any[];
  }>;
}): SpotifyDailyTrack | null {
  const {
    level,
    selectedDay,
    activeStudyDays,
    liveTracks,
    assignedTracks,
  } = params;
  const norm = normalizeStudentLevel(level);

  // 1. Determine active study days in calendar order
  const calendarOrder: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const effectiveStudyDays = activeStudyDays && activeStudyDays.length > 0
    ? calendarOrder.filter((d) => activeStudyDays.includes(d))
    : calendarOrder.slice(0, 5); // Default 5x (Mon-Fri)

  // 2. Check if selectedDay is an active study day or Rest Day
  const studyDayIndex = effectiveStudyDays.indexOf(selectedDay);
  if (studyDayIndex === -1) {
    return null; // Rest Day: No track scheduled
  }

  // 3. PRIORITY 1: Existing assignment for this day (preserves state after F5 or new login)
  if (Array.isArray(assignedTracks) && assignedTracks.length > 0) {
    const existing = assignedTracks.find((a) => a && a.day?.toLowerCase() === selectedDay.toLowerCase());
    if (existing) {
      const rawId = existing.trackId || (existing.url ? extractSpotifyTrackId(existing.url) : null) || (existing.trackUrl ? extractSpotifyTrackId(existing.trackUrl) : null);
      if (rawId) {
        const title = existing.title || existing.trackTitle || 'Daily Spotify Listening';
        const artist = existing.artist || existing.artistOrHost || 'Adm Itissimple';
        const url = existing.url || existing.trackUrl || `https://open.spotify.com/track/${rawId}`;
        const embedUrl = existing.embedUrl || `https://open.spotify.com/embed/track/${rawId}?utm_source=generator&theme=0`;

        return {
          dayOfWeek: selectedDay,
          dayLabelPt: DAY_LABELS[selectedDay]?.pt || selectedDay,
          dayLabelEn: DAY_LABELS[selectedDay]?.en || selectedDay,
          trackId: rawId,
          title,
          artist,
          url,
          embedUrl,
          imageUrl: existing.imageUrl,
          albumImages: existing.albumImages || [],
          teacherTipPt: existing.teacherTipPt || `Prática auditiva com "${title}" (${artist}).`,
          teacherTipEn: existing.teacherTipEn || `Active listening practice with "${title}" (${artist}).`,
        };
      }
    }
  }

  // 4. PRIORITY 2: Sequential selection from live playlist tracks
  const cached = getCachedPlaylistTracks(norm);
  const pool = (liveTracks && liveTracks.length > 0)
    ? liveTracks
    : (cached && cached.length > 0 ? cached : []);

  if (pool.length === 0) {
    return null;
  }

  // Pick sequential track corresponding to the study day index within the available playlist
  const trackIndex = studyDayIndex % pool.length;
  const baseTrack = pool[trackIndex];
  if (!baseTrack) return null;

  const rawId = baseTrack.trackId;
  const embedUrl = `https://open.spotify.com/embed/track/${rawId}?utm_source=generator&theme=0`;
  const trackDirectUrl = `https://open.spotify.com/track/${rawId}`;

  return {
    ...baseTrack,
    url: trackDirectUrl,
    embedUrl,
    dayOfWeek: selectedDay,
    dayLabelPt: DAY_LABELS[selectedDay]?.pt || baseTrack.dayLabelPt,
    dayLabelEn: DAY_LABELS[selectedDay]?.en || baseTrack.dayLabelEn,
  };
}

/**
 * Retrieves the daily track sequentially mapped from the level's playlist for the selected day.
 */
export function getDailySpotifyTrackForStudent(
  rawLevel: string | EnglishLevel | null | undefined,
  dayOfWeek: DayOfWeek,
  activeStudyDays?: DayOfWeek[],
  weeklyCycle: number = 1,
  studentJournal?: StudentJournalEntry[],
  assignedTracks?: any[]
): SpotifyDailyTrack | null {
  return selectCurrentDaySpotifyTrack({
    level: rawLevel,
    selectedDay: dayOfWeek,
    activeStudyDays,
    weeklyCycle,
    studentJournal,
    assignedTracks,
  });
}

/**
 * Known corrupt, deleted, or dummy Spotify IDs
 */
export const CORRUPT_SPOTIFY_IDS = [
  '5VzKk7uV4C8Oa2sH3eWz9Y',
  '2qO2kUvhq8XwXhL3oG5F9y',
  '3G7aZ1pL9yQw6Vx8J2nMbT',
  '07eP4C54x26sOaVn9z1mJy',
  '07eP4C54x26sQaVn9z1mJy',
  '0nvd89U6p8s95aGphBvR5J',
  '4bHsxqRFFGmgTyKeUmF9ox',
];

export interface SpotifyUrlValidationResult {
  isValid: boolean;
  type: 'track' | 'episode' | 'show' | 'playlist' | 'album' | null;
  id: string | null;
  canonicalUrl: string | null;
  embedUrl: string | null;
  directUrl: string;
  contentType: SpotifyContentType;
  errorMessage?: string;
}

/**
 * Strict parser and sanitizer for Spotify URLs and URIs.
 * Validates /track/, /episode/, /show/, /playlist/, and /album/ URLs.
 * Handles internationalized prefixes (e.g. /intl-pt/) and strips query parameters.
 */
export function parseSpotifyUrl(url: string | null | undefined): SpotifyUrlValidationResult {
  if (!url || typeof url !== 'string') {
    return {
      isValid: false,
      type: null,
      id: null,
      canonicalUrl: null,
      embedUrl: null,
      directUrl: 'https://open.spotify.com',
      contentType: 'podcast',
      errorMessage: 'URL do Spotify não fornecida.',
    };
  }

  const clean = url.trim();

  for (const badId of CORRUPT_SPOTIFY_IDS) {
    if (clean.includes(badId)) {
      return {
        isValid: false,
        type: 'episode',
        id: badId,
        canonicalUrl: null,
        embedUrl: null,
        directUrl: 'https://open.spotify.com',
        contentType: 'podcast',
        errorMessage: 'Link corrompido do Spotify detectado: este conteúdo não existe no catálogo ("Couldn\'t find that podcast").',
      };
    }
  }

  // Matches standard web URL or internationalized URL or embed URL
  const webRegex = /^(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)*spotify\.com(?::\d+)?\/(?:intl-[a-z]{2,3}(?:-[a-z]{2,4})?\/)?(?:embed\/)?(track|episode|show|playlist|album)\/([a-zA-Z0-9]{15,35})(?:[?#].*)?$/i;
  const webMatch = clean.match(webRegex);

  if (webMatch) {
    const type = webMatch[1].toLowerCase() as 'track' | 'episode' | 'show' | 'playlist' | 'album';
    const id = webMatch[2];

    const canonicalUrl = `https://open.spotify.com/${type}/${id}`;
    const embedUrl = `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
    const contentType: SpotifyContentType = (type === 'episode' || type === 'show') ? 'podcast' : type === 'playlist' ? 'playlist' : 'music';

    return {
      isValid: true,
      type,
      id,
      canonicalUrl,
      embedUrl,
      directUrl: canonicalUrl,
      contentType,
    };
  }

  // Matches Spotify URI (spotify:track:ID, etc.)
  const uriRegex = /^spotify:(track|episode|show|playlist|album):([a-zA-Z0-9]{15,35})$/i;
  const uriMatch = clean.match(uriRegex);

  if (uriMatch) {
    const type = uriMatch[1].toLowerCase() as 'track' | 'episode' | 'show' | 'playlist' | 'album';
    const id = uriMatch[2];

    const canonicalUrl = `https://open.spotify.com/${type}/${id}`;
    const embedUrl = `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
    const contentType: SpotifyContentType = (type === 'episode' || type === 'show') ? 'podcast' : type === 'playlist' ? 'playlist' : 'music';

    return {
      isValid: true,
      type,
      id,
      canonicalUrl,
      embedUrl,
      directUrl: canonicalUrl,
      contentType,
    };
  }

  if (!clean.includes('spotify.com') && !clean.startsWith('spotify:')) {
    return {
      isValid: false,
      type: null,
      id: null,
      canonicalUrl: null,
      embedUrl: null,
      directUrl: 'https://open.spotify.com',
      contentType: 'podcast',
      errorMessage: 'O link fornecido não pertence ao Spotify. Cole uma URL do open.spotify.com.',
    };
  }

  return {
    isValid: false,
    type: null,
    id: null,
    canonicalUrl: null,
    embedUrl: null,
    directUrl: 'https://open.spotify.com',
    contentType: 'podcast',
    errorMessage: 'Formato de link não suportado. Use links de episódios (/episode/), músicas (/track/) ou podcasts (/show/).',
  };
}

/**
 * Extracts a clean Spotify track or episode ID from any URL, URI, or ID string
 */
export function extractSpotifyTrackId(urlOrId?: string | null): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const clean = urlOrId.trim();
  if (/^[a-zA-Z0-9]{15,35}$/.test(clean)) return clean;
  const parsed = parseSpotifyUrl(clean);
  return parsed.isValid ? parsed.id : null;
}

/**
 * Returns the ordered array of tracks for a student's level
 */
export function getWeeklySpotifyTracksForLevel(level: NormalizedStudentLevel = 'beginner'): (SpotifyDailyTrack | null)[] {
  const playlist = SPOTIFY_LEVEL_PLAYLISTS[level] || SPOTIFY_LEVEL_PLAYLISTS.beginner;
  return DAYS_SEQUENCE.map((day) => playlist.tracks[day]);
}

/**
 * Validates if the string is a valid Spotify URL or URI
 */
export function isValidSpotifyUrl(url: string): boolean {
  return parseSpotifyUrl(url).isValid;
}

/**
 * Extracts the embed URL for an iframe from any standard Spotify link
 */
export function getSpotifyEmbedUrl(url: string): string | null {
  const result = parseSpotifyUrl(url);
  return result.isValid ? result.embedUrl : null;
}

/**
 * Returns a standardized canonical web link to open in Spotify app/browser
 */
export function getSpotifyDirectUrl(url: string): string {
  const result = parseSpotifyUrl(url);
  if (result.isValid && result.canonicalUrl) {
    return result.canonicalUrl;
  }
  if (url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    return url.trim();
  }
  return 'https://open.spotify.com';
}

/**
 * Determines content type (podcast vs music) from Spotify URL
 */
export function getSpotifyContentType(url: string): SpotifyContentType {
  const result = parseSpotifyUrl(url);
  if (result.isValid) {
    return result.contentType;
  }
  if (!url) return 'podcast';
  const lower = url.toLowerCase();
  if (lower.includes('/episode/') || lower.includes(':episode:') || lower.includes('/show/') || lower.includes(':show:')) {
    return 'podcast';
  }
  if (lower.includes('/track/') || lower.includes(':track:') || lower.includes('/album/') || lower.includes(':album:')) {
    return 'music';
  }
  if (lower.includes('/playlist/') || lower.includes(':playlist:')) {
    return 'playlist';
  }
  return 'podcast';
}
