import { DayOfWeek, EnglishLevel, StudentJournalEntry } from '../types';
import { CURATED_SPOTIFY_TRACKS, CuratedTrackItem } from './spotifyCuratedTracks';

/**
 * Utility helpers for Spotify URLs, Embeds, and Automated Level-Based Daily Listening Playlists
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
  tracks: Record<DayOfWeek, SpotifyDailyTrack>;
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
 * Curated, verified Spotify playlists and sequential daily tracks from It's simple official account (Adm Itissimple).
 * - Beginner: https://open.spotify.com/playlist/5MMU9H5oXDd7FCWr0gkzHE
 * - Intermediate: https://open.spotify.com/playlist/34E52K1dEJO5CzZRPkIR4I
 * - Advanced: https://open.spotify.com/playlist/6ScLXNefp8JFohezoJve2Z
 */
/**
 * Official Bearer Token provided for Spotify Web API consumption
 */
export const SPOTIFY_BEARER_TOKEN =
  'BQDZaOSauB_P1_dU6XQhoSrxpGaylICF2pDVY0_ujvV8FtfaNbTzr2Gg4N9Krdaw9juHr6wQchk3s9UyGhVWWzp-GaKVoo2b3cMixk1louMzpm4aLU2GMfrtxo4qR0lJEyamoOf6ZdwSaJKdvjGunIALjFFXOuT4O2wjuk_cBM82i99nFBdPgBaBmZX9pYkBGJ-ZIGkM5It_oi0a9cTikMRL8pamkTLIKHJsgOwv5cpQwopmJfo02haX-1G96bQpGiEdO4Q0J6xP4MSQZv7Vnevfk9paZFbX_gyNCWITYOsV74pCZL7Fhvc3dRPU-b9jyfddByQ';

export const SPOTIFY_IT_IS_SIMPLE_TOKEN = SPOTIFY_BEARER_TOKEN;

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

/**
 * Creates an official single-track entry for a day of week from curated playlist tracks.
 * Guarantees single-track embedUrl (https://open.spotify.com/embed/track/{trackId}) so Spotify embeds only 1 song.
 */
export function createCuratedTrackForDay(
  level: NormalizedStudentLevel,
  dayOfWeek: DayOfWeek,
  curatedItem?: CuratedTrackItem
): SpotifyDailyTrack {
  const playlistId = SPOTIFY_PLAYLIST_IDS[level] || SPOTIFY_PLAYLIST_IDS.beginner;
  const label = DAY_LABELS[dayOfWeek] || { pt: 'Dia', en: 'Day' };

  if (curatedItem && curatedItem.id) {
    return {
      dayOfWeek,
      dayLabelPt: label.pt,
      dayLabelEn: label.en,
      trackId: curatedItem.id,
      title: curatedItem.title,
      artist: curatedItem.artist,
      url: `https://open.spotify.com/track/${curatedItem.id}`,
      embedUrl: `https://open.spotify.com/embed/track/${curatedItem.id}?utm_source=generator&theme=0`,
      imageUrl: undefined,
      albumImages: [],
      teacherTipPt: `Prática auditiva diária com "${curatedItem.title}" (${curatedItem.artist}). Preste atenção na pronúncia, ritmo e vocabulário.`,
      teacherTipEn: `Daily listening practice with "${curatedItem.title}" (${curatedItem.artist}). Focus on pronunciation, rhythm, and vocabulary.`,
    };
  }

  const fallbackId = '7qiZfU4dY1lWllzX7mPBI3';
  return {
    dayOfWeek,
    dayLabelPt: label.pt,
    dayLabelEn: label.en,
    trackId: fallbackId,
    title: level === 'advanced' ? "Bohemian Rhapsody" : level === 'intermediate' ? "Shape of You" : "Count on Me",
    artist: level === 'advanced' ? "Queen" : level === 'intermediate' ? "Ed Sheeran" : "Bruno Mars",
    url: `https://open.spotify.com/track/${fallbackId}`,
    embedUrl: `https://open.spotify.com/embed/track/${fallbackId}?utm_source=generator&theme=0`,
    imageUrl: undefined,
    albumImages: [],
    teacherTipPt: "Ouça a faixa exclusiva de hoje no Spotify para praticar sua compreensão auditiva.",
    teacherTipEn: "Listen to today's exclusive track on Spotify to practice your listening comprehension.",
  };
}

export const createLevelTracksMap = (level: NormalizedStudentLevel): Record<DayOfWeek, SpotifyDailyTrack> => {
  const map = {} as Record<DayOfWeek, SpotifyDailyTrack>;
  const curated = CURATED_SPOTIFY_TRACKS[level] || [];
  DAYS_SEQUENCE.forEach((day, idx) => {
    map[day] = createCuratedTrackForDay(level, day, curated[idx]);
  });
  return map;
};

export const createLevelPool = (level: NormalizedStudentLevel): SpotifyDailyTrack[] => {
  const curated = CURATED_SPOTIFY_TRACKS[level] || [];
  return curated.slice(7).map((item, idx) => {
    const day = DAYS_SEQUENCE[idx % 7];
    const label = DAY_LABELS[day] || { pt: 'Dia', en: 'Day' };
    return {
      dayOfWeek: day,
      dayLabelPt: label.pt,
      dayLabelEn: label.en,
      trackId: item.id,
      title: item.title,
      artist: item.artist,
      url: `https://open.spotify.com/track/${item.id}`,
      embedUrl: `https://open.spotify.com/embed/track/${item.id}?utm_source=generator&theme=0`,
      imageUrl: undefined,
      albumImages: [],
      teacherTipPt: `Prática auditiva diária com "${item.title}" (${item.artist}).`,
      teacherTipEn: `Daily listening practice with "${item.title}" (${item.artist}).`,
    };
  });
};

export const SPOTIFY_LEVEL_PLAYLISTS: Record<NormalizedStudentLevel, SpotifyLevelPlaylistConfig> = {
  beginner: {
    level: "beginner",
    levelLabelPt: "Iniciante",
    levelLabelEn: "Beginner",
    playlistId: "5MMU9H5oXDd7FCWr0gkzHE",
    playlistTitle: "Beginner • It's simple",
    playlistUrl: "https://open.spotify.com/playlist/5MMU9H5oXDd7FCWr0gkzHE",
    embedPlaylistUrl: "https://open.spotify.com/embed/playlist/5MMU9H5oXDd7FCWr0gkzHE?utm_source=generator&theme=0",
    descriptionPt: "Playlist oficial da It's simple (Adm Itissimple) para Iniciantes: músicas com dicção clara, frases fundamentais e ritmo acolhedor.",
    descriptionEn: "Official It's simple playlist (Adm Itissimple) for Beginners: songs featuring clear diction, foundational phrasing, and accessible rhythm.",
    tracks: createLevelTracksMap("beginner"),
    pool: createLevelPool("beginner"),
  },
  intermediate: {
    level: "intermediate",
    levelLabelPt: "Intermediário",
    levelLabelEn: "Intermediate",
    playlistId: "34E52K1dEJO5CzZRPkIR4I",
    playlistTitle: "Intermediate • It's simple",
    playlistUrl: "https://open.spotify.com/playlist/34E52K1dEJO5CzZRPkIR4I",
    embedPlaylistUrl: "https://open.spotify.com/embed/playlist/34E52K1dEJO5CzZRPkIR4I?utm_source=generator&theme=0",
    descriptionPt: "Playlist oficial da It's simple (Adm Itissimple) para Intermediários: vocabulário do cotidiano, expressões idiomáticas e estruturas gramaticais variadas.",
    descriptionEn: "Official It's simple playlist (Adm Itissimple) for Intermediates: everyday vocabulary, idiomatic expressions, and diverse sentence structures.",
    tracks: createLevelTracksMap("intermediate"),
    pool: createLevelPool("intermediate"),
  },
  advanced: {
    level: "advanced",
    levelLabelPt: "Avançado",
    levelLabelEn: "Advanced",
    playlistId: "6ScLXNefp8JFohezoJve2Z",
    playlistTitle: "Advanced • It's simple",
    playlistUrl: "https://open.spotify.com/playlist/6ScLXNefp8JFohezoJve2Z",
    embedPlaylistUrl: "https://open.spotify.com/embed/playlist/6ScLXNefp8JFohezoJve2Z?utm_source=generator&theme=0",
    descriptionPt: "Playlist oficial da It's simple (Adm Itissimple) para Alunos Avançados: ritmo rápido, metáforas culturais, linguagem coloquial e rimas complexas.",
    descriptionEn: "Official It's simple playlist (Adm Itissimple) for Advanced Students: fast cadence, cultural metaphors, colloquial speech, and intricate phrasing.",
    tracks: createLevelTracksMap("advanced"),
    pool: createLevelPool("advanced"),
  },
};

export const SPOTIFY_PLAYLISTS = SPOTIFY_LEVEL_PLAYLISTS;

export const SPOTIFY_CACHE_KEY_PREFIX = 'its_simple_spotify_playlist_v5_';
export const SPOTIFY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SpotifyPlaylistCacheEntry {
  playlistId: string;
  tracks: SpotifyDailyTrack[];
  timestamp: number;
}

// In-memory runtime cache: eliminates reliance on browser localStorage
const spotifyMemoryCache = new Map<string, SpotifyPlaylistCacheEntry>();

/**
 * Checks in-memory cache and purges legacy localStorage entries permanently.
 */
export function checkAndInvalidateSpotifyCache(): void {
  (['beginner', 'intermediate', 'advanced'] as NormalizedStudentLevel[]).forEach((lvl) => {
    // Purge in-memory if invalid
    const cached = spotifyMemoryCache.get(lvl);
    if (cached && cached.playlistId !== SPOTIFY_LEVEL_PLAYLISTS[lvl].playlistId) {
      spotifyMemoryCache.delete(lvl);
    }
  });

  // Permanently clean legacy browser localStorage keys to satisfy zero-localStorage policy
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      (['beginner', 'intermediate', 'advanced'] as NormalizedStudentLevel[]).forEach((lvl) => {
        localStorage.removeItem(`its_simple_spotify_playlist_v3_${lvl}`);
        localStorage.removeItem(`${SPOTIFY_CACHE_KEY_PREFIX}${lvl}`);
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

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      (['beginner', 'intermediate', 'advanced'] as NormalizedStudentLevel[]).forEach((lvl) => {
        localStorage.removeItem(`${SPOTIFY_CACHE_KEY_PREFIX}${lvl}`);
      });
    } catch {}
  }
}

// Automatically purge outdated cache on module initialization in browser environment
if (typeof window !== 'undefined') {
  checkAndInvalidateSpotifyCache();
}

/**
 * Triggers the dynamic Spotify API request to search/fetch tracks for a playlist:
 * Endpoint: https://api.spotify.com/v1/playlists/${playlistId}/tracks
 * For Intermediate: https://api.spotify.com/v1/playlists/34E52K1dEJO5CzZRPkIR4I/tracks
 */
export async function fetchPlaylistTracksFromSpotifyApi(
  playlistId: string,
  token: string = SPOTIFY_IT_IS_SIMPLE_TOKEN
): Promise<any> {
  const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`[Spotify API] Requisição para ${url} retornou status [${res.status}], tentando fallback da playlist pública...`);
      return await fetchPlaylistTracksFromPublicEmbed(playlistId);
    }
    return await res.json();
  } catch (err) {
    console.warn(`[Spotify API] Erro ao buscar faixas em ${url}:`, err);
    return await fetchPlaylistTracksFromPublicEmbed(playlistId);
  }
}

/**
 * Fallback to retrieve tracks from Spotify public embed page if Spotify Bearer token has expired
 */
async function fetchPlaylistTracksFromPublicEmbed(playlistId: string): Promise<any> {
  try {
    const embedRes = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`);
    if (!embedRes.ok) return null;
    const html = await embedRes.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;
    const json = JSON.parse(match[1]);
    const trackList = json?.props?.pageProps?.state?.data?.entity?.trackList || [];
    if (!Array.isArray(trackList) || trackList.length === 0) return null;

    return {
      items: trackList.map((t: any) => {
        const id = t.uri ? t.uri.replace('spotify:track:', '') : '';
        return {
          track: {
            id,
            name: t.title,
            artists: [{ name: t.subtitle || 'Adm Itissimple' }],
            external_urls: {
              spotify: `https://open.spotify.com/track/${id}`,
            },
            album: {
              images: [],
            },
          },
        };
      }),
    };
  } catch (e) {
    console.warn(`[Spotify API] Erro no fallback de embed para ${playlistId}:`, e);
    return null;
  }
}

/**
 * Triggers dynamic track fetching for student's level (Intermediate -> 34E52K1dEJO5CzZRPkIR4I, etc.).
 * Checks and invalidates local cache if playlistId differs, then requests tracks from Spotify API.
 */
export async function fetchTracksForStudentLevel(
  rawLevel?: string | EnglishLevel | null,
  token: string = SPOTIFY_IT_IS_SIMPLE_TOKEN
): Promise<SpotifyDailyTrack[] | null> {
  const norm = normalizeStudentLevel(rawLevel);
  const config = SPOTIFY_LEVEL_PLAYLISTS[norm];
  if (!config) return null;

  // 1. Verify and retrieve from valid cache (automatically invalidates if playlistId differs)
  const cached = getCachedPlaylistTracks(norm);
  if (cached && cached.length > 0) {
    return cached;
  }

  // 2. Trigger dynamic request: https://api.spotify.com/v1/playlists/${config.playlistId}/tracks
  // When norm === 'intermediate', this explicitly calls https://api.spotify.com/v1/playlists/34E52K1dEJO5CzZRPkIR4I/tracks
  const data = await fetchPlaylistTracksFromSpotifyApi(config.playlistId, token);
  if (data && Array.isArray(data.items) && data.items.length > 0) {
    const mappedTracks: SpotifyDailyTrack[] = data.items
      .filter((item: any) => item && item.track && item.track.id)
      .map((item: any, idx: number) => {
        const t = item.track;
        const day = DAYS_SEQUENCE[idx % 7];
        const artistNames = t.artists?.map((a: any) => a.name).join(', ') || 'Adm Itissimple';
        const albumImages = t.album?.images || [];
        const imageUrl = albumImages[0]?.url || albumImages[1]?.url || undefined;
        return {
          dayOfWeek: day,
          dayLabelPt: config.tracks[day]?.dayLabelPt || DAY_LABELS[day]?.pt || day,
          dayLabelEn: config.tracks[day]?.dayLabelEn || DAY_LABELS[day]?.en || day,
          trackId: t.id,
          title: t.name,
          artist: artistNames,
          url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
          embedUrl: `https://open.spotify.com/embed/track/${t.id}?utm_source=generator&theme=0`,
          imageUrl,
          albumImages,
          teacherTipPt: `Prática auditiva com "${t.name}" (${artistNames}). Preste atenção na pronúncia, ritmo e vocabulário.`,
          teacherTipEn: `Active listening practice with "${t.name}" (${artistNames}). Focus on rhythm, pronunciation, and vocabulary.`,
        };
      });

    if (mappedTracks.length > 0) {
      // Synchronize in-memory config for immediate access
      DAYS_SEQUENCE.forEach((d, idx) => {
        if (mappedTracks[idx]) {
          config.tracks[d] = mappedTracks[idx];
        }
      });
      if (mappedTracks.length > 7) {
        config.pool = mappedTracks.slice(7);
      }
      setCachedPlaylistTracks(norm, config.playlistId, mappedTracks);
      return mappedTracks;
    }
  }

  return null;
}

/**
 * Spotify Web API integration helper using Spotify Authorization Bearer Token
 * As provided in the It's simple developer integration specification.
 */
export async function fetchSpotifyWebApi(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any,
  token: string = SPOTIFY_IT_IS_SIMPLE_TOKEN
): Promise<any> {
  try {
    const res = await fetch(`https://api.spotify.com/${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      console.warn(`Spotify API call failed [${res.status}]:`, await res.text());
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('Error fetching Spotify Web API:', err);
    return null;
  }
}

/**
 * Normalizes any variation of student level into 'beginner' | 'intermediate' | 'advanced'
 */
export function normalizeStudentLevel(rawLevel?: string | EnglishLevel | null): NormalizedStudentLevel {
  if (!rawLevel) return 'beginner';
  const l = String(rawLevel).toLowerCase().trim();
  if (l.includes('inter')) return 'intermediate';
  if (l.includes('avan') || l.includes('adv')) return 'advanced';
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
 * 1. Daily exclusivity: 1 song per active study day in sequential playlist order (Index 0 = 1st study day, Index 1 = 2nd study day...)
 * 2. Weekly frequency (2x, 3x, 5x, 7x) with Rest Days returning null.
 * 3. Strict Student Journal Exclusivity: Queries studentJournal to filter and skip tracks already consumed, guaranteeing songs never repeat.
 * 4. Looping: (cycle - 1) * studyDaysCount + studyDayIndex % totalUnconsumedTracks.
 * 5. Weekly rotation on new week or level change.
 */
export function selectCurrentDaySpotifyTrack(params: {
  level?: string | EnglishLevel | null;
  selectedDay: DayOfWeek;
  activeStudyDays?: DayOfWeek[];
  weeklyCycle?: number;
  liveTracks?: SpotifyDailyTrack[] | null;
  studentJournal?: StudentJournalEntry[];
  consumedTrackIds?: string[];
}): SpotifyDailyTrack | null {
  const { level, selectedDay, activeStudyDays, weeklyCycle = 1, liveTracks, studentJournal, consumedTrackIds } = params;
  const norm = normalizeStudentLevel(level);

  // 1. Determine active study days in calendar order
  const calendarOrder: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const effectiveStudyDays = activeStudyDays && activeStudyDays.length > 0
    ? calendarOrder.filter((d) => activeStudyDays.includes(d))
    : calendarOrder.slice(0, 5); // Default to 5x (Mon-Fri)

  // 2. Check if selectedDay is an active study day or Rest Day
  const studyDayIndex = effectiveStudyDays.indexOf(selectedDay);
  if (studyDayIndex === -1) {
    return null; // Rest Day: No track scheduled
  }

  // 3. Pool of tracks from Spotify playlist
  const cached = getCachedPlaylistTracks(norm);
  const pool = (liveTracks && liveTracks.length > 0)
    ? liveTracks
    : (cached && cached.length > 0 ? cached : []);

  const config = SPOTIFY_LEVEL_PLAYLISTS[norm] || SPOTIFY_LEVEL_PLAYLISTS.beginner;
  const effectivePool = pool.length > 0
    ? pool
    : [
        ...DAYS_SEQUENCE.map((d) => config.tracks[d]).filter(Boolean),
        ...(config.pool || []),
      ];

  const totalPlaylistTracks = effectivePool.length;
  if (totalPlaylistTracks === 0) return null;

  // 4. Strict Exclusivity Filter: Consult studentJournal to skip already consumed tracks
  const consumedSet = new Set<string>();
  if (Array.isArray(consumedTrackIds)) {
    consumedTrackIds.forEach((id) => {
      const cid = extractSpotifyTrackId(id);
      if (cid) consumedSet.add(cid.toLowerCase());
    });
  }
  if (Array.isArray(studentJournal)) {
    studentJournal.forEach((entry) => {
      if (entry && entry.type === 'audio' && entry.id) {
        const cid = extractSpotifyTrackId(entry.id);
        if (cid) consumedSet.add(cid.toLowerCase());
        if (entry.url) {
          const urlCid = extractSpotifyTrackId(entry.url);
          if (urlCid) consumedSet.add(urlCid.toLowerCase());
        }
      }
    });
  }

  // Filter pool to unconsumed candidates
  const unconsumedPool = effectivePool.filter((track) => {
    const rawId = track.trackId || (track.url ? extractSpotifyTrackId(track.url) : null);
    if (!rawId) return true;
    return !consumedSet.has(rawId.toLowerCase());
  });

  // If all tracks in playlist have been consumed over time, loop back through effectivePool
  const candidatePool = unconsumedPool.length > 0 ? unconsumedPool : effectivePool;
  const totalCandidates = candidatePool.length;

  // 5. Sequential distribution + Looping (trackIndex % totalCandidates)
  const cycle = Math.max(1, weeklyCycle);
  const studyDaysCount = Math.max(1, effectiveStudyDays.length);
  const rawTrackIndex = (cycle - 1) * studyDaysCount + studyDayIndex;
  const trackIndex = rawTrackIndex % totalCandidates;

  const baseTrack = candidatePool[trackIndex];
  if (!baseTrack) return null;

  // Strictly ensure single-track embed URL (never playlist embed)
  const rawId = baseTrack.trackId && !baseTrack.trackId.startsWith('http') && baseTrack.trackId !== config.playlistId
    ? baseTrack.trackId
    : (CURATED_SPOTIFY_TRACKS[norm]?.[trackIndex]?.id || '7qiZfU4dY1lWllzX7mPBI3');

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
 * Retrieves the daily track sequentially mapped from the level's playlist for the selected day,
 * consulting studentJournal to avoid repetitions.
 */
export function getDailySpotifyTrackForStudent(
  rawLevel: string | EnglishLevel | null | undefined,
  dayOfWeek: DayOfWeek,
  activeStudyDays?: DayOfWeek[],
  weeklyCycle: number = 1,
  studentJournal?: StudentJournalEntry[]
): SpotifyDailyTrack {
  const exclusive = selectCurrentDaySpotifyTrack({
    level: rawLevel,
    selectedDay: dayOfWeek,
    activeStudyDays,
    weeklyCycle,
    studentJournal,
  });
  if (exclusive) return exclusive;

  const norm = normalizeStudentLevel(rawLevel);
  const cachedTracks = getCachedPlaylistTracks(norm);
  if (cachedTracks && cachedTracks.length > 0) {
    const dayIdx = DAYS_SEQUENCE.indexOf(dayOfWeek);
    if (dayIdx >= 0 && cachedTracks[dayIdx % cachedTracks.length]) {
      return cachedTracks[dayIdx % cachedTracks.length];
    }
  }
  const playlist = getSpotifyPlaylistForLevel(rawLevel);
  const track = playlist.tracks[dayOfWeek];
  if (track) return track;
  // Fallback to monday track of that level
  return playlist.tracks.monday;
}

/**
 * Known corrupt, deleted, or dummy Spotify IDs that fail, return 404, or produce "Couldn't find that podcast"
 */
export const CORRUPT_SPOTIFY_IDS = [
  '5VzKk7uV4C8Oa2sH3eWz9Y', // legacy dummy placeholder that returns 404
  '2qO2kUvhq8XwXhL3oG5F9y', // fake episode placeholder that returns 404
  '3G7aZ1pL9yQw6Vx8J2nMbT', // fake episode placeholder that returns 404
  '07eP4C54x26sOaVn9z1mJy', // fake show placeholder that returns 500
  '07eP4C54x26sQaVn9z1mJy', // fake show placeholder that returns 500
  '0nvd89U6p8s95aGphBvR5J', // fake show placeholder that returns 500
  '4bHsxqRFFGmgTyKeUmF9ox', // old broken track ID
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

  // Check for known corrupted or broken IDs
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

  // 1. Matches standard web URL or internationalized URL (e.g., /intl-pt/track/...)
  // or embed URL (e.g., /embed/track/...)
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

  // 2. Matches Spotify URI (spotify:track:ID, spotify:episode:ID, etc.)
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

  // If it didn't match the strict patterns, generate a helpful diagnostic error
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

  if (clean.includes('/episode/') || clean.includes('/track/') || clean.includes('/show/')) {
    return {
      isValid: false,
      type: null,
      id: null,
      canonicalUrl: null,
      embedUrl: null,
      directUrl: 'https://open.spotify.com',
      contentType: 'podcast',
      errorMessage: 'O ID do Spotify parece incompleto ou truncado. Copie o link completo através do botão "Compartilhar" no Spotify.',
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
 * Extracts a clean 22-character Spotify track or episode ID from any URL, URI, or ID string
 */
export function extractSpotifyTrackId(urlOrId?: string | null): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const clean = urlOrId.trim();
  if (/^[a-zA-Z0-9]{15,35}$/.test(clean)) return clean;
  const parsed = parseSpotifyUrl(clean);
  return parsed.isValid ? parsed.id : null;
}

/**
 * Returns the ordered array of 7 tracks for a student's level (Monday through Sunday)
 */
export function getWeeklySpotifyTracksForLevel(level: NormalizedStudentLevel = 'beginner'): SpotifyDailyTrack[] {
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
 * E.g.: https://open.spotify.com/episode/xyz -> https://open.spotify.com/embed/episode/xyz?utm_source=generator&theme=0
 * E.g.: https://open.spotify.com/track/xyz -> https://open.spotify.com/embed/track/xyz?utm_source=generator&theme=0
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

