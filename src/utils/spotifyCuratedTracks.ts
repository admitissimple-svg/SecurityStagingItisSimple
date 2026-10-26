export interface CuratedTrackItem {
  id: string;
  title: string;
  artist: string;
}

/**
 * HOTFIX SPOTIFY — SECURITY STAGING:
 * Static/fixed alternative song lists have been deactivated.
 * All tracks must be fetched dynamically from the official Spotify playlists via backend API.
 */
export const CURATED_SPOTIFY_TRACKS: Record<'beginner' | 'intermediate' | 'advanced', CuratedTrackItem[]> = {
  beginner: [],
  intermediate: [],
  advanced: [],
};
