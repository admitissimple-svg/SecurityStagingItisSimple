import dotenv from 'dotenv';
dotenv.config();

/**
 * Backend Spotify Service for It's Simple (Security Staging)
 * - Safe Spotify Web API client_credentials authentication
 * - Automatic token expiration detection & renewal
 * - Zero token/credentials leakage to frontend or logs
 * - Full playlist tracks fetching with pagination (no hardcoded limits)
 * - Preserves exact playlist order as maintained by administrators
 * - Dynamic, cyclical sequential track assignment per student & level
 * - Strict track ID identification & separation between assigned vs listened
 * - Zero static fallbacks or silent replacement with fake tracks
 */

export type SpotifyLevel = 'beginner' | 'intermediate' | 'advanced';

export interface SpotifyTrack {
  trackId: string;
  title: string;
  artist: string;
  url: string;
  embedUrl: string;
  durationMs: number;
  imageUrl?: string;
  albumImages?: Array<{ url: string; height?: number; width?: number }>;
  playlistId: string;
  playlistTitle: string;
  level: SpotifyLevel;
}

export interface StudentSpotifyCycleState {
  cycle: number;
  assignedInCycleTrackIds: string[];
  lastAssignedTrackId: string | null;
  history: Array<{
    trackId: string;
    day: string;
    assignedAt: string;
    cycle: number;
    weekId?: string;
  }>;
}

export interface SpotifyAssignment {
  id: string;
  activityId: string;
  studentEmail?: string;
  studentUid?: string;
  teacherUid?: string;
  teacherEmail?: string;
  day: string;
  trackId: string;
  trackTitle: string;
  trackUrl: string;
  embedUrl: string;
  title: string;
  artistOrHost: string;
  type: 'music';
  instructions: string;
  assignedAt: string;
  level: SpotifyLevel;
  playlistId: string;
  playlistTitle: string;
  trackIndex: number;
  cycle: number;
}

/**
 * Official Spotify Playlist IDs by level (It's simple official account: Adm Itissimple)
 * - Beginner: 5MMU9H5oXDd7FCWr0gkzHE
 * - Intermediate: 34E52K1dEJO5CzZRPkIR4I
 * - Advanced: 6ScLXNefp8JFohezoJve2Z
 */
export const OFFICIAL_SPOTIFY_PLAYLISTS: Record<
  SpotifyLevel,
  {
    id: string;
    title: string;
    descriptionPt: string;
    descriptionEn: string;
  }
> = {
  beginner: {
    id: '5MMU9H5oXDd7FCWr0gkzHE',
    title: "Beginner • It's simple",
    descriptionPt: "Playlist oficial da It's simple (Adm Itissimple) para Iniciantes: músicas com dicção clara e ritmo acolhedor.",
    descriptionEn: "Official It's simple playlist (Adm Itissimple) for Beginners: clear diction and accessible rhythm.",
  },
  intermediate: {
    id: '34E52K1dEJO5CzZRPkIR4I',
    title: "Intermediate • It's simple",
    descriptionPt: "Playlist oficial da It's simple (Adm Itissimple) para Intermediários: vocabulário do cotidiano e expressões idiomáticas.",
    descriptionEn: "Official It's simple playlist (Adm Itissimple) for Intermediates: everyday vocabulary and idiomatic expressions.",
  },
  advanced: {
    id: '6ScLXNefp8JFohezoJve2Z',
    title: "Advanced • It's simple",
    descriptionPt: "Playlist oficial da It's simple (Adm Itissimple) para Alunos Avançados: ritmo rápido, metáforas e linguagem coloquial.",
    descriptionEn: "Official It's simple playlist (Adm Itissimple) for Advanced Students: fast cadence and intricate phrasing.",
  },
};

export const DAYS_SEQUENCE = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

// In-memory token cache (never persisted, never sent to frontend)
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

// In-memory playlist cache with TTL to optimize repeated requests while respecting dynamic edits
interface PlaylistCacheEntry {
  playlistId: string;
  tracks: SpotifyTrack[];
  cachedAt: number;
}
const playlistCache = new Map<SpotifyLevel, PlaylistCacheEntry>();
export const PLAYLIST_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Normalizes any variation of student level into 'beginner' | 'intermediate' | 'advanced'
 */
export function normalizeStudentLevel(rawLevel?: string | null): SpotifyLevel {
  if (!rawLevel) return 'beginner';
  const l = String(rawLevel).toLowerCase().trim();
  if (l.includes('inter') || l.includes('b1') || l.includes('b2')) return 'intermediate';
  if (l.includes('avan') || l.includes('adv') || l.includes('c1') || l.includes('c2')) return 'advanced';
  return 'beginner';
}

/**
 * Checks whether Spotify credentials are configured in environment variables
 */
export function getSpotifyConfigStatus(): {
  configured: boolean;
  authMethod: 'client_credentials' | 'direct_token' | 'none';
  missingEnvVars: string[];
} {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  const directToken = process.env.SPOTIFY_TOKEN?.trim();

  const missing: string[] = [];
  if (!clientId) missing.push('SPOTIFY_CLIENT_ID');
  if (!clientSecret) missing.push('SPOTIFY_CLIENT_SECRET');

  if (clientId && clientSecret) {
    return { configured: true, authMethod: 'client_credentials', missingEnvVars: [] };
  }
  if (directToken) {
    return { configured: true, authMethod: 'direct_token', missingEnvVars: [] };
  }
  return { configured: false, authMethod: 'none', missingEnvVars: missing };
}

/**
 * Resets the in-memory access token (used during testing or after 401)
 */
export function resetCachedSpotifyToken(): void {
  cachedAccessToken = null;
  tokenExpiresAt = 0;
}

/**
 * Clears the in-memory playlist cache
 */
export function clearSpotifyPlaylistCache(level?: SpotifyLevel): void {
  if (level) {
    playlistCache.delete(level);
  } else {
    playlistCache.clear();
  }
}

/**
 * Securely obtains a valid Spotify access token using Client Credentials flow or direct token.
 * Automatically renews when expired (or within 60s of expiration).
 */
export async function getSpotifyAccessToken(forceRefresh = false): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  const directToken = process.env.SPOTIFY_TOKEN?.trim();

  // If using direct token without client credentials
  if (directToken && (!clientId || !clientSecret)) {
    return directToken;
  }

  // Use cached token if still valid (60-second buffer before expiry)
  if (!forceRefresh && cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  if (!clientId || !clientSecret) {
    if (directToken) {
      return directToken;
    }
    throw new Error(
      'SPOTIFY_CREDENTIALS_MISSING: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be configured in environment variables.'
    );
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Spotify Auth Error [${response.status}]: Failed to obtain token from Spotify. ${errorBody}`);
  }

  const data = (await response.json()) as { access_token: string; token_type: string; expires_in: number };
  if (!data.access_token) {
    throw new Error('Spotify Auth Error: Invalid response, missing access_token.');
  }

  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (Number(data.expires_in || 3600) * 1000);
  return cachedAccessToken;
}

/**
 * Fetches all tracks from the official Spotify playlist with complete API pagination.
 * Preserves the exact order of tracks in the playlist.
 * Throws on failure — never replaces with hardcoded or fallback tracks.
 */
export async function fetchOfficialPlaylistTracks(
  rawLevel: string | SpotifyLevel,
  force = false
): Promise<SpotifyTrack[]> {
  const level = normalizeStudentLevel(rawLevel);
  const playlistConfig = OFFICIAL_SPOTIFY_PLAYLISTS[level];
  const playlistId = playlistConfig.id;

  // Check in-memory cache if not forced
  if (!force) {
    const cached = playlistCache.get(level);
    if (cached && cached.playlistId === playlistId && Date.now() - cached.cachedAt < PLAYLIST_CACHE_TTL_MS) {
      return cached.tracks;
    }
  }

  let token = await getSpotifyAccessToken();

  let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50&offset=0`;
  const tracks: SpotifyTrack[] = [];
  let retry401Done = false;

  while (nextUrl) {
    let res = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    // Handle token expiration during pagination
    if (res.status === 401 && !retry401Done) {
      retry401Done = true;
      resetCachedSpotifyToken();
      token = await getSpotifyAccessToken(true);
      res = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Spotify API Playlist Error [${res.status}]: ${errText}`);
    }

    const data = (await res.json()) as any;
    const items = data.items || [];

    for (const item of items) {
      if (item && item.track && item.track.id) {
        const t = item.track;
        const artistNames = t.artists?.map((a: any) => a.name).join(', ') || 'Adm Itissimple';
        const albumImages = t.album?.images || [];
        const imageUrl = albumImages[0]?.url || albumImages[1]?.url || undefined;

        tracks.push({
          trackId: t.id,
          title: t.name,
          artist: artistNames,
          url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
          embedUrl: `https://open.spotify.com/embed/track/${t.id}?utm_source=generator&theme=0`,
          durationMs: t.duration_ms || 180000,
          imageUrl,
          albumImages,
          playlistId,
          playlistTitle: playlistConfig.title,
          level,
        });
      }
    }

    nextUrl = data.next || null;
  }

  if (tracks.length === 0) {
    throw new Error(`Spotify Playlist Error: Official playlist ${playlistId} returned 0 valid tracks.`);
  }

  playlistCache.set(level, {
    playlistId,
    tracks,
    cachedAt: Date.now(),
  });

  return tracks;
}

/**
 * Retrieves or initializes the student's persistent Spotify cycle state.
 */
export function getOrCreateStudentCycleState(
  db: any,
  studentKey: string,
  level: SpotifyLevel
): StudentSpotifyCycleState {
  if (!db.studentSpotifyCycles) db.studentSpotifyCycles = {};
  if (!db.studentSpotifyCycles[studentKey]) db.studentSpotifyCycles[studentKey] = {};
  if (!db.studentSpotifyCycles[studentKey][level]) {
    db.studentSpotifyCycles[studentKey][level] = {
      cycle: 1,
      assignedInCycleTrackIds: [],
      lastAssignedTrackId: null,
      history: [],
    };
  }
  return db.studentSpotifyCycles[studentKey][level];
}

/**
 * Selects the next sequential track from the playlist for a student in accordance with Rule 3:
 * 1. Follows the exact current order of the playlist.
 * 2. Does not repeat songs while there are unassigned songs in the current cycle.
 * 3. When all available tracks in the playlist are exhausted, returns to the first track (index 0) and increments cycle.
 * 4. Incorporates added songs into next eligible selections.
 * 5. Ignores removed songs, keeping past assignments in history intact.
 * 6. Preserves past assignments even if playlist order changed.
 * 7. History is NEVER erased when cycling.
 */
export function selectNextTrackFromPlaylist(
  playlistTracks: SpotifyTrack[],
  cycleState: StudentSpotifyCycleState,
  day: string,
  weekId?: string
): { track: SpotifyTrack; isNewCycle: boolean } {
  if (!playlistTracks || playlistTracks.length === 0) {
    throw new Error('Playlist has no tracks available for selection.');
  }

  // Filter current playlist tracks that have NOT yet been assigned in the current cycle
  const assignedInCycleSet = new Set(cycleState.assignedInCycleTrackIds);
  const eligibleTracks = playlistTracks.filter((t) => !assignedInCycleSet.has(t.trackId));

  let chosenTrack: SpotifyTrack;
  let isNewCycle = false;

  if (eligibleTracks.length > 0) {
    // Take the first unassigned track in current playlist order
    chosenTrack = eligibleTracks[0];
  } else {
    // All available tracks in the playlist have been exhausted in this cycle!
    // Start new cycle at track 1 of the current playlist
    cycleState.cycle += 1;
    cycleState.assignedInCycleTrackIds = [];
    chosenTrack = playlistTracks[0];
    isNewCycle = true;
  }

  // Record assignment in cycle and history
  cycleState.assignedInCycleTrackIds.push(chosenTrack.trackId);
  cycleState.lastAssignedTrackId = chosenTrack.trackId;
  cycleState.history.push({
    trackId: chosenTrack.trackId,
    day,
    assignedAt: new Date().toISOString(),
    cycle: cycleState.cycle,
    weekId,
  });

  return { track: chosenTrack, isNewCycle };
}

/**
 * Distributes Spotify tracks for a student's active study days.
 * - Respects active study days (Rest Days receive no Spotify track or are excluded).
 * - Follows sequential cycle without weekly offset jumps on filtered arrays.
 * - Saves individual sequence in studentSpotifyCycles and studentSpotifyAssignments.
 * - Updates student routine in studentRoutinesMap.
 */
export function distributeWeeklySpotifyForStudentEngine(params: {
  db: any;
  studentEmail: string;
  studentUid: string;
  level: string;
  playlistTracks: SpotifyTrack[];
  activeDays?: string[];
  teacherUid?: string;
  teacherEmail?: string;
  weekId?: string;
}): SpotifyAssignment[] {
  const { db, studentEmail, studentUid, level, playlistTracks, activeDays, teacherUid, teacherEmail, weekId } = params;
  const normLevel = normalizeStudentLevel(level);

  const cleanEmail = (studentEmail || '').trim().toLowerCase();
  const cleanUid = (studentUid || '').trim();
  const canonicalKey = cleanUid || cleanEmail;
  if (!canonicalKey) return [];

  const targetKeys = Array.from(new Set([cleanUid, cleanEmail].filter(Boolean) as string[]));

  const cycleState = getOrCreateStudentCycleState(db, canonicalKey, normLevel);

  // Determine active study days in calendar order
  const calendarOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const configuredDays: string[] =
    activeDays && Array.isArray(activeDays) && activeDays.length > 0
      ? activeDays
      : db.weeklyStudyDays?.[canonicalKey] && db.weeklyStudyDays[canonicalKey].length > 0
      ? db.weeklyStudyDays[canonicalKey]
      : db.userProfiles?.[canonicalKey]?.weeklyStudyDays && db.userProfiles[canonicalKey].weeklyStudyDays.length > 0
      ? db.userProfiles[canonicalKey].weeklyStudyDays
      : calendarOrder.slice(0, 5); // default 5x (Mon-Fri)

  const effectiveStudyDays = calendarOrder.filter((d) => configuredDays.includes(d));
  const daysToAssign = effectiveStudyDays.length > 0 ? effectiveStudyDays : calendarOrder;

  const assignments: SpotifyAssignment[] = [];
  const now = new Date().toISOString();

  daysToAssign.forEach((day, idx) => {
    const { track } = selectNextTrackFromPlaylist(playlistTracks, cycleState, day, weekId);

    const assignment: SpotifyAssignment = {
      id: `spot-assign-${day}-${Date.now()}-${idx}`,
      activityId: `act-${day}-2`,
      studentEmail: cleanEmail,
      studentUid: cleanUid,
      teacherUid: (teacherUid || '').trim(),
      teacherEmail: (teacherEmail || '').trim(),
      day,
      trackId: track.trackId,
      trackTitle: track.title,
      trackUrl: track.url,
      embedUrl: track.embedUrl,
      title: track.title,
      artistOrHost: track.artist,
      type: 'music',
      instructions: `Sugestão diária do Teacher: Prática auditiva com "${track.title}" (${track.artist}).`,
      assignedAt: now,
      level: normLevel,
      playlistId: track.playlistId,
      playlistTitle: track.playlistTitle,
      trackIndex: idx + 1,
      cycle: cycleState.cycle,
    };

    assignments.push(assignment);
  });

  // Persist to all target keys
  if (!db.studentSpotifyAssignments) db.studentSpotifyAssignments = {};
  if (!db.studentSpotifyCycles) db.studentSpotifyCycles = {};

  targetKeys.forEach((key) => {
    db.studentSpotifyAssignments[key] = assignments;
    if (!db.studentSpotifyCycles[key]) db.studentSpotifyCycles[key] = {};
    db.studentSpotifyCycles[key][normLevel] = cycleState;
  });

  // Synchronize student routine in studentRoutinesMap
  if (!db.studentRoutinesMap) db.studentRoutinesMap = {};
  targetKeys.forEach((key) => {
    const studentRoutine = db.studentRoutinesMap[key];
    if (studentRoutine) {
      daysToAssign.forEach((day, idx) => {
        const assign = assignments[idx];
        if (studentRoutine[day] && Array.isArray(studentRoutine[day])) {
          let matched = false;
          studentRoutine[day] = studentRoutine[day].map((item: any) => {
            const isTarget =
              item.id?.endsWith('2') ||
              item.activityName?.toLowerCase().includes('podcast') ||
              item.activityName?.toLowerCase().includes('áudio') ||
              item.activityName?.toLowerCase().includes('audio');
            if (isTarget) {
              matched = true;
              return {
                ...item,
                teacherSpotify: {
                  id: assign.id,
                  url: assign.trackUrl,
                  trackId: assign.trackId,
                  title: assign.title,
                  artistOrHost: assign.artistOrHost,
                  instructions: assign.instructions,
                  type: 'music',
                  addedAt: assign.assignedAt,
                  level: normLevel,
                  playlistId: assign.playlistId,
                  playlistTitle: assign.playlistTitle,
                  trackIndex: assign.trackIndex,
                },
              };
            }
            return item;
          });
          if (!matched && studentRoutine[day].length > 0) {
            studentRoutine[day][0] = {
              ...studentRoutine[day][0],
              teacherSpotify: {
                id: assign.id,
                url: assign.trackUrl,
                trackId: assign.trackId,
                title: assign.title,
                artistOrHost: assign.artistOrHost,
                instructions: assign.instructions,
                type: 'music',
                addedAt: assign.assignedAt,
                level: normLevel,
                playlistId: assign.playlistId,
                playlistTitle: assign.playlistTitle,
                trackIndex: assign.trackIndex,
              },
            };
          }
        }
      });
      db.studentRoutinesMap[key] = studentRoutine;
    }
  });

  return assignments;
}
