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

import rawChannelPlaylists from '../data/channelPlaylists.json';

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
    return token;
  } catch (err: any) {
    console.error('Error during YouTube OAuth authentication:', err);
    throw err;
  }
}

/**
 * Directly queries YouTube Data API v3 playlists.list for all playlists owned by adm.itissimple@gmail.com
 * using the authenticated OAuth 2.0 access token (with `mine=true`).
 */
export async function fetchPlaylistsFromYouTubeApi(accessToken: string): Promise<YouTubePlaylistItem[]> {
  if (!accessToken) {
    throw new Error('OAuth access token is required to fetch YouTube playlists.');
  }

  // 1. Fetch all playlists owned by the authenticated account
  const listUrl = 'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails,status&mine=true&maxResults=50';
  const listRes = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (listRes.status === 401) {
    throw new Error('AUTH_EXPIRED: Access token expired or invalid');
  }

  if (!listRes.ok) {
    const errorText = await listRes.text();
    console.warn(`YouTube API playlists.list failed [${listRes.status}]:`, errorText);
    throw new Error(`YouTube API error: ${listRes.status}`);
  }

  const listData = await listRes.json();
  const rawPlaylists: any[] = listData.items || [];

  if (rawPlaylists.length === 0) {
    return [];
  }

  // 2. Fetch playlist items (videos) for each retrieved playlist
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
      const itemsUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${plId}&maxResults=50`;
      const itemsRes = await fetch(itemsUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        const rawItems = itemsData.items || [];
        videos = rawItems
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
      }
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
 * 2. If force=true or server list is empty and an OAuth token exists, queries YouTube API directly.
 * 3. Identifies whether re-authentication is required.
 * 4. Yields fallback playlists so students always have working curated topics.
 */
export async function fetchDynamicYouTubePlaylists(options?: {
  force?: boolean;
}): Promise<FetchPlaylistsResult> {
  const force = Boolean(options?.force);
  const token = getGoogleOAuthToken();

  // 1. Try server endpoint first
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const serverUrl = `/api/youtube-playlists${force ? '?force=true' : ''}`;
    const serverRes = await fetch(serverUrl, { headers });

    if (serverRes.ok) {
      const serverPlaylists = await serverRes.json();
      if (Array.isArray(serverPlaylists) && serverPlaylists.length > 0) {
        return {
          playlists: serverPlaylists,
          source: 'server',
        };
      }
    }
  } catch (serverErr) {
    console.warn('Error fetching playlists from /api/youtube-playlists:', serverErr);
  }

  // 2. If server has no playlists or force sync is desired, and we have an OAuth token, query YouTube directly
  if (token) {
    try {
      const directPlaylists = await fetchPlaylistsFromYouTubeApi(token);
      if (directPlaylists.length > 0) {
        return {
          playlists: directPlaylists,
          source: 'api',
        };
      }
    } catch (apiErr: any) {
      const errMsg = apiErr?.message || '';
      if (errMsg.includes('AUTH_EXPIRED') || errMsg.includes('401')) {
        return {
          playlists: DEFAULT_CURATED_PLAYLISTS,
          reauthRequired: true,
          error: 'Sessão do YouTube expirada. Clique para reautenticar a conta adm.itissimple@gmail.com.',
          source: 'fallback',
        };
      }
      console.warn('Direct YouTube API fetch notice:', apiErr);
    }
  } else {
    // No token stored yet
    return {
      playlists: DEFAULT_CURATED_PLAYLISTS,
      reauthRequired: true,
      error: 'Conecte a conta do YouTube (adm.itissimple@gmail.com) para sincronizar todas as suas playlists em tempo real.',
      source: 'fallback',
    };
  }

  return {
    playlists: DEFAULT_CURATED_PLAYLISTS,
    source: 'fallback',
  };
}
