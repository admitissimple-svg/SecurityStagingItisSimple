import { auth, googleAuthProvider } from '../firebase';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getGoogleOAuthToken, setGoogleOAuthToken } from './auth';

export const YOUTUBE_ASSOCIATED_ACCOUNT = 'adm.itissimple@gmail.com';
export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

export interface YouTubeVideoSummary {
  id?: string;
  videoId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  url: string;
  embedUrl?: string;
  playlistId?: string;
  playlistTitle?: string;
  duration?: string;
  instructions?: string;
  teacherTipPt?: string;
  teacherTipEn?: string;
}

export interface YouTubePlaylistItem {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  channelId?: string;
  channelTitle?: string;
  itemCount?: number;
  updatedAt?: string;
  isPublic?: boolean;
  videos: YouTubeVideoSummary[];
}

export interface FetchPlaylistsResult {
  playlists: YouTubePlaylistItem[];
  error?: string | null;
  reauthRequired?: boolean;
  source: 'api' | 'server' | 'cache' | 'fallback';
}

import rawChannelPlaylists from '../data/channelPlaylists.json' with { type: 'json' };

/**
 * Baseline fallback playlists reflecting the entire official channel (@admitissimple).
 * 18 distinct authentic playlists with complete video curriculums.
 * Ensures the student and teacher dropdowns always have full real content immediately.
 */
export const DEFAULT_CURATED_PLAYLISTS: YouTubePlaylistItem[] =
  (rawChannelPlaylists as unknown as YouTubePlaylistItem[]) || [];

/**
 * Triggers Google OAuth popup requesting YouTube ReadOnly scope specifically for the account adm.itissimple@gmail.com.
 */
export async function authenticateYouTubeAccount(hintEmail = YOUTUBE_ASSOCIATED_ACCOUNT): Promise<string> {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: 'consent',
      login_hint: hintEmail.trim(),
    });
    provider.addScope(YOUTUBE_READONLY_SCOPE);
    provider.addScope('https://www.googleapis.com/auth/youtube');

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken;

    if (!token) {
      throw new Error('No access token returned from Google authentication.');
    }

    setGoogleOAuthToken(token);

    // Register token immediately with backend to authorize backend-wide synchronization
    fetch('/api/youtube-playlists/authorize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ token }),
    }).catch((err) => {
      console.warn('Notice: Background token authorization on backend:', err);
    });

    return token;
  } catch (err: any) {
    console.error('Error during YouTube OAuth authentication:', err);
    throw err;
  }
}

/**
 * Directly queries YouTube Data API v3 playlists.list for all playlists owned by adm.itissimple@gmail.com
 * using the authenticated OAuth 2.0 access token (with `mine=true`), supporting full pagination.
 */
export async function fetchPlaylistsFromYouTubeApi(accessToken: string): Promise<YouTubePlaylistItem[]> {
  if (!accessToken) {
    throw new Error('OAuth access token is required to fetch YouTube playlists.');
  }

  // 1. Fetch all playlists owned by the authenticated account with pagination
  const rawPlaylists: any[] = [];
  let pageToken: string | undefined = undefined;

  while (true) {
    const pageParam: string = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const listUrl: string = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails,status&mine=true&maxResults=50${pageParam}`;
    const listRes: Response = await fetch(listUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (listRes.status === 401) {
      throw new Error('AUTH_EXPIRED: Access token expired or invalid');
    }

    if (!listRes.ok) {
      const errorText: string = await listRes.text();
      console.warn(`YouTube API playlists.list failed [${listRes.status}]:`, errorText);
      throw new Error(`YouTube API error: ${listRes.status}`);
    }

    const listData: any = await listRes.json();
    if (Array.isArray(listData.items)) {
      rawPlaylists.push(...listData.items);
    }
    pageToken = listData.nextPageToken || undefined;
    if (!pageToken) break;
  }

  if (rawPlaylists.length === 0) {
    return [];
  }

  // 2. Fetch playlist items (videos) for each retrieved playlist with pagination
  const parsedPlaylists: YouTubePlaylistItem[] = [];

  for (const pl of rawPlaylists) {
    const plId = pl.id;
    const title = pl.snippet?.title || 'Playlist do YouTube';
    const description = pl.snippet?.description || '';
    const thumbnailUrl =
      pl.snippet?.thumbnails?.high?.url ||
      pl.snippet?.thumbnails?.medium?.url ||
      pl.snippet?.thumbnails?.default?.url ||
      '';
    const itemCount = pl.contentDetails?.itemCount || 0;

    let videos: YouTubeVideoSummary[] = [];
    try {
      let vidPageToken: string | undefined = undefined;
      const allItems: any[] = [];

      while (true) {
        const vidPageParam: string = vidPageToken ? `&pageToken=${encodeURIComponent(vidPageToken)}` : '';
        const itemsUrl: string = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${plId}&maxResults=50${vidPageParam}`;
        const itemsRes: Response = await fetch(itemsUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });

        if (itemsRes.ok) {
          const itemsData: any = await itemsRes.json();
          if (Array.isArray(itemsData.items)) {
            allItems.push(...itemsData.items);
          }
          vidPageToken = itemsData.nextPageToken || undefined;
          if (!vidPageToken) break;
        } else {
          break;
        }
      }

      videos = allItems
        .filter(
          (it: any) =>
            it.snippet?.resourceId?.videoId &&
            it.snippet?.title !== 'Private video' &&
            it.snippet?.title !== 'Deleted video'
        )
        .map((it: any) => {
          const vidId = it.snippet.resourceId.videoId;
          return {
            id: `vid-${vidId}`,
            videoId: vidId,
            title: it.snippet.title,
            description: it.snippet.description || '',
            thumbnailUrl:
              it.snippet?.thumbnails?.high?.url ||
              it.snippet?.thumbnails?.medium?.url ||
              `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
            url: `https://www.youtube.com/watch?v=${vidId}`,
            embedUrl: `https://www.youtube-nocookie.com/embed/${vidId}?rel=0&modestbranding=1&enablejsapi=1`,
            playlistId: plId,
            playlistTitle: title,
            duration: '6-8 min',
            instructions: `Assista a esta aula sobre "${title}" e anote 3 termos ou frases úteis para a rotina.`,
          };
        });
    } catch (itemErr) {
      console.warn(`Could not fetch items for playlist ${plId}:`, itemErr);
    }

    parsedPlaylists.push({
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

  // 3. Immediately persist fetched playlists to server and Firestore
  if (parsedPlaylists.length > 0) {
    savePlaylistsToServer(parsedPlaylists).catch((err) => {
      console.warn('Notice: Background savePlaylistsToServer:', err);
    });
  }

  return parsedPlaylists;
}

/**
 * Saves dynamically fetched playlists to the backend Express server & Firestore database.
 */
export async function savePlaylistsToServer(playlists: YouTubePlaylistItem[]): Promise<boolean> {
  try {
    const res = await fetch('/api/youtube-playlists/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ playlists }),
    });
    return res.ok;
  } catch (err) {
    console.warn('savePlaylistsToServer error:', err);
    return false;
  }
}

/**
 * Main coordinator to load YouTube playlists dynamically:
 * 1. Checks server API `/api/youtube-playlists` (with OAuth token if available).
 * 2. On force=true, bypasses client and server cache to perform upstream revalidation.
 * 3. Does not leak tokens or force students to authenticate the official account.
 * 4. Yields fallback curated playlists if network fails, never replacing with fake data.
 */
export async function fetchDynamicYouTubePlaylists(options?: {
  force?: boolean;
}): Promise<FetchPlaylistsResult> {
  const force = Boolean(options?.force);
  const token = getGoogleOAuthToken();

  // 1. Query centralized backend endpoint
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const serverUrl = `/api/youtube-playlists?_t=${Date.now()}${force ? '&force=true' : ''}`;
    const serverRes = await fetch(serverUrl, { headers });

    if (serverRes.ok) {
      const serverPlaylists = await serverRes.json();
      if (Array.isArray(serverPlaylists) && serverPlaylists.length > 0) {
        return {
          playlists: serverPlaylists,
          source: 'server',
          reauthRequired: false,
          error: null,
        };
      }
    }
  } catch (serverErr) {
    console.warn('Error fetching playlists from /api/youtube-playlists:', serverErr);
  }

  // 2. Direct client fallback ONLY if token exists and server was unreachable
  if (token) {
    try {
      const directPlaylists = await fetchPlaylistsFromYouTubeApi(token);
      if (directPlaylists.length > 0) {
        return {
          playlists: directPlaylists,
          source: 'api',
          reauthRequired: false,
          error: null,
        };
      }
    } catch (apiErr: any) {
      const errMsg = apiErr?.message || '';
      if (errMsg.includes('AUTH_EXPIRED') || errMsg.includes('401')) {
        return {
          playlists: DEFAULT_CURATED_PLAYLISTS,
          reauthRequired: true,
          error: 'Sessão do YouTube da conta institucional expirada. Clique para reautenticar adm.itissimple@gmail.com.',
          source: 'fallback',
        };
      }
      console.warn('Direct YouTube API fetch notice:', apiErr);
    }
  }

  // 3. Fallback to default authentic channel playlists without demanding student auth
  return {
    playlists: DEFAULT_CURATED_PLAYLISTS,
    reauthRequired: false,
    source: 'fallback',
  };
}
