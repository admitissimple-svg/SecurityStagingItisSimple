import { useEffect, useRef, useState, useCallback } from 'react';

export interface BehavioralVideoTrackerOptions {
  videoId?: string | null;
  videoTitle?: string;
  retentionSeconds?: number; // Valid retention time in seconds (default: 35s)
  onCompleted?: (videoId: string, title?: string) => void;
  isAlreadyCompleted?: boolean;
}

/**
 * Hook to automatically track YouTube video completion behaviorally:
 * - Detects YouTube Player onStateChange === 0 (YT.PlayerState.ENDED)
 * - Detects valid retention playback time (onStateChange === 1 for >= retentionSeconds)
 * - Detects player interaction fallback (click / focus / play)
 */
export function useBehavioralVideoTracker({
  videoId,
  videoTitle,
  retentionSeconds = 35,
  onCompleted,
  isAlreadyCompleted = false,
}: BehavioralVideoTrackerOptions) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [hasCompleted, setHasCompleted] = useState(isAlreadyCompleted);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const completedRef = useRef<boolean>(isAlreadyCompleted);

  useEffect(() => {
    completedRef.current = isAlreadyCompleted;
    setHasCompleted(isAlreadyCompleted);
  }, [isAlreadyCompleted]);

  const triggerCompletion = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setHasCompleted(true);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (videoId && onCompleted) {
      // Defer execution using setTimeout to guarantee it never fires during React render / commit / state-update phase
      setTimeout(() => {
        onCompleted(videoId, videoTitle);
      }, 0);
    }
  }, [videoId, videoTitle, onCompleted]);

  // Listen for YouTube Iframe API postMessages
  useEffect(() => {
    if (!videoId || completedRef.current) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        let data = event.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch {
            return;
          }
        }
        if (!data || typeof data !== 'object') return;

        // Check if event is from YouTube Iframe API
        // Format: { event: "onStateChange", info: 0 } or { info: { playerState: 0 } }
        let state: number | null = null;

        if (data.event === 'onStateChange') {
          state = typeof data.info === 'number' ? data.info : null;
        } else if (data.info && typeof data.info.playerState === 'number') {
          state = data.info.playerState;
        }

        if (state !== null) {
          if (state === 0) {
            // YT.PlayerState.ENDED -> Immediate completion!
            setIsPlaying(false);
            setTimeout(() => triggerCompletion(), 0);
          } else if (state === 1) {
            // YT.PlayerState.PLAYING
            setIsPlaying(true);
          } else if (state === 2 || state === 0) {
            // YT.PlayerState.PAUSED or ENDED
            setIsPlaying(false);
          }
        }
      } catch {
        // Silently ignore cross-origin parse errors
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [videoId, triggerCompletion]);

  // Track playback time when isPlaying is true
  useEffect(() => {
    if (isPlaying && !completedRef.current) {
      timerRef.current = setInterval(() => {
        setPlaybackSeconds((prev) => {
          const next = prev + 1;
          if (next >= retentionSeconds) {
            setTimeout(() => triggerCompletion(), 0);
          }
          return next;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isPlaying, retentionSeconds, triggerCompletion]);

  // Send listening handshake to iframe when loaded
  const handleIframeLoad = useCallback(() => {
    try {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'listening' }),
          '*'
        );
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'addEventListener',
            args: ['onStateChange'],
          }),
          '*'
        );
      }
    } catch {
      // Ignore cross-origin postMessage restrictions
    }
  }, []);

  // Behavioral interaction handler: user starts playing or clicks player container
  const handlePlayerInteraction = useCallback(() => {
    if (completedRef.current) return;
    setIsPlaying(true);
  }, []);

  // External click handler (e.g. user opens video in YouTube)
  const handleExternalWatchClick = useCallback(() => {
    // When student clicks to watch on YouTube, register completion behaviorally
    triggerCompletion();
  }, [triggerCompletion]);

  return {
    iframeRef,
    isPlaying,
    playbackSeconds,
    hasCompleted,
    handleIframeLoad,
    handlePlayerInteraction,
    handleExternalWatchClick,
    triggerCompletion,
  };
}

export interface BehavioralAudioTrackerOptions {
  trackId?: string | null;
  trackTitle?: string;
  artist?: string;
  onCompleted?: (trackId: string, title?: string, artist?: string) => void;
  isAlreadyCompleted?: boolean;
}

/**
 * Hook to automatically track Spotify/Audio completion behaviorally:
 * - Detects user interaction with player or listening initiation
 * - Detects playing track to completion or opening track
 */
export function useBehavioralAudioTracker({
  trackId,
  trackTitle,
  artist,
  onCompleted,
  isAlreadyCompleted = false,
}: BehavioralAudioTrackerOptions) {
  const [hasCompleted, setHasCompleted] = useState(isAlreadyCompleted);
  const completedRef = useRef<boolean>(isAlreadyCompleted);

  useEffect(() => {
    completedRef.current = isAlreadyCompleted;
    setHasCompleted(isAlreadyCompleted);
  }, [isAlreadyCompleted]);

  const triggerCompletion = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setHasCompleted(true);
    if (trackId && onCompleted) {
      setTimeout(() => {
        onCompleted(trackId, trackTitle, artist);
      }, 0);
    }
  }, [trackId, trackTitle, artist, onCompleted]);

  const handleAudioInteraction = useCallback(() => {
    triggerCompletion();
  }, [triggerCompletion]);

  return {
    hasCompleted,
    handleAudioInteraction,
    triggerCompletion,
  };
}
