import { useEffect, useRef, useCallback } from 'react';
import { LiveLesson } from '../types';
import { apiClient } from '../utils/apiClient';

export const DEFAULT_LESSONS_POLL_INTERVAL_MS = 30000;

export interface UseLessonsRevalidationOptions {
  user: {
    uid?: string;
    email?: string;
    role?: string;
  } | null;
  setLessons: React.Dispatch<React.SetStateAction<LiveLesson[]>>;
  intervalMs?: number;
  enabled?: boolean;
}

/**
 * Compare two lesson arrays to prevent unnecessary React re-renders when nothing changed.
 */
export function areLessonsEqual(a: LiveLesson[], b: LiveLesson[]): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const itemA = a[i];
    const itemB = b[i];
    if (
      itemA.id !== itemB.id ||
      itemA.status !== itemB.status ||
      itemA.startDateTime !== itemB.startDateTime ||
      itemA.endDateTime !== itemB.endDateTime ||
      itemA.completedAt !== itemB.completedAt ||
      itemA.cancelledAt !== itemB.cancelledAt ||
      itemA.proposedNewStartDateTime !== itemB.proposedNewStartDateTime ||
      itemA.proposedNewEndDateTime !== itemB.proposedNewEndDateTime ||
      itemA.proposalStatus !== itemB.proposalStatus
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Consolidate server lessons with existing client state, strictly preserving
 * cancelled and completed invariants.
 */
export function consolidateServerLessons(
  currentLessons: LiveLesson[],
  serverLessons: LiveLesson[]
): LiveLesson[] {
  const map = new Map<string, LiveLesson>();

  // 1. Put server lessons first
  for (const l of serverLessons || []) {
    if (l?.id) {
      map.set(l.id, { ...l });
    }
  }

  // 2. Reconcile with existing client state (preserves recent local completions/cancellations)
  for (const existing of currentLessons || []) {
    if (!existing?.id) continue;
    const serverLesson = map.get(existing.id);
    if (serverLesson) {
      const isCancelled =
        existing.status === 'cancelled' ||
        Boolean(existing.cancelledAt) ||
        serverLesson.status === 'cancelled' ||
        Boolean(serverLesson.cancelledAt);

      const isCompleted =
        existing.status === 'completed' ||
        Boolean(existing.completedAt) ||
        serverLesson.status === 'completed' ||
        Boolean(serverLesson.completedAt);

      if (isCancelled) {
        serverLesson.status = 'cancelled';
        serverLesson.cancelledAt = existing.cancelledAt || serverLesson.cancelledAt || new Date().toISOString();
      } else if (isCompleted) {
        serverLesson.status = 'completed';
        serverLesson.completedAt = existing.completedAt || serverLesson.completedAt || new Date().toISOString();
      }
    } else {
      map.set(existing.id, existing);
    }
  }

  // 3. Guarantee invariants: cancelled and completed are permanent
  map.forEach((l, id) => {
    if (l.status === 'cancelled' || l.cancelledAt) {
      map.set(id, {
        ...l,
        status: 'cancelled',
        cancelledAt: l.cancelledAt || new Date().toISOString(),
      });
    } else if (l.status === 'completed' || l.completedAt) {
      map.set(id, {
        ...l,
        status: 'completed',
        completedAt: l.completedAt || new Date().toISOString(),
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => {
    const tA = new Date(a.startDateTime || 0).getTime();
    const tB = new Date(b.startDateTime || 0).getTime();
    return tA - tB;
  });
}

/**
 * Lightweight, authenticated revalidation hook for live lessons.
 *
 * Implements:
 * - Automatic revalidation every 30s during active session
 * - Immediate revalidation on tab visibility return
 * - Polling suspension when tab is hidden
 * - In-flight deduplication to avoid redundant concurrent requests
 * - Safe error handling that never clears valid state on network failure
 * - Complete teardown of timers and listeners on logout/cleanup
 */
export function useLessonsRevalidation({
  user,
  setLessons,
  intervalMs = DEFAULT_LESSONS_POLL_INTERVAL_MS,
  enabled = true,
}: UseLessonsRevalidationOptions) {
  const inFlightRef = useRef(false);
  const isCancelledRef = useRef(false);
  const lastFetchTimeRef = useRef(0);
  const timerRef = useRef<any>(null);

  const revalidate = useCallback(async (): Promise<LiveLesson[] | null> => {
    if (!enabled || !user?.uid || isCancelledRef.current || inFlightRef.current) {
      return null;
    }

    inFlightRef.current = true;
    try {
      const serverLessons = await apiClient.get<LiveLesson[]>('/api/lessons');

      if (isCancelledRef.current) {
        return null;
      }

      if (Array.isArray(serverLessons)) {
        lastFetchTimeRef.current = Date.now();
        setLessons((prev) => {
          const consolidated = consolidateServerLessons(prev, serverLessons);
          if (areLessonsEqual(prev, consolidated)) {
            return prev;
          }
          return consolidated;
        });
        return serverLessons;
      }
      return null;
    } catch (err) {
      // Invariant: Network failure or temporary server error NEVER wipes out valid state
      if (!isCancelledRef.current) {
        console.warn('[useLessonsRevalidation] Revalidation notice (preserving valid state):', err);
      }
      return null;
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled, user?.uid, setLessons]);

  useEffect(() => {
    isCancelledRef.current = false;

    if (!enabled || !user?.uid) {
      return () => {
        isCancelledRef.current = true;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }

    // 1. Initial authenticated load
    revalidate();

    // 2. Scheduled polling: suspended when tab is hidden
    const effectiveInterval = Math.max(5000, intervalMs);
    timerRef.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        // Tab is hidden: suspend polling
        return;
      }
      revalidate();
    }, effectiveInterval);

    // 3. Tab visibility listener: revalidate when returning to the tab
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastFetchTimeRef.current >= 2000) {
          revalidate();
        }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      isCancelledRef.current = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [enabled, user?.uid, user?.email, intervalMs, revalidate]);

  return { revalidate };
}
