import { auth } from '../firebase';
import { DirectMessage } from '../types';
import { getAccessToken } from './auth';

// Pure in-memory session cache for non-blocking active session rendering
// ZERO dependency on localStorage or direct client SDK Firestore access:
// Authenticated backend (/api/chat-messages -> Firestore '(default)' direct_messages) is the single source of truth.
const inMemoryDmCache = new Map<string, DirectMessage[]>();
const conversationListeners = new Map<string, Set<(messages: DirectMessage[]) => void>>();
const inFlightReadIds = new Set<string>();

const POLL_INTERVAL_MS = 10000;

export function clearDirectMessagesMemoryCache(): void {
  inMemoryDmCache.clear();
  inFlightReadIds.clear();
}

export function normalizeUid(id?: string | null): string {
  if (!id) return '';
  return String(id).trim();
}

async function resolveBearerToken(): Promise<string | null> {
  try {
    const directToken = await auth?.currentUser?.getIdToken().catch(() => null);
    if (directToken) return directToken;
  } catch {}
  try {
    return (await getAccessToken().catch(() => null)) || null;
  } catch {
    return null;
  }
}

function normalizeServerMessage(
  m: any,
  fallbackStudentUid: string,
  fallbackNativeFriendUid: string
): DirectMessage {
  return {
    id: String(m.id || `msg-${Date.now()}`),
    studentUid: normalizeUid(m.studentUid) || fallbackStudentUid,
    studentEmail: m.studentEmail || '',
    studentName: m.studentName || '',
    nativeFriendUid: normalizeUid(m.nativeFriendUid || m.teacherUid || m.tutorUid) || fallbackNativeFriendUid,
    nativeFriendEmail: m.nativeFriendEmail || '',
    nativeFriendName: m.nativeFriendName || '',
    nativeFriendAvatar: m.nativeFriendAvatar || '',
    senderUid: normalizeUid(m.senderUid),
    senderEmail: m.senderEmail || '',
    senderName: m.senderName || '',
    senderRole: m.senderRole || 'student',
    recipientUid: normalizeUid(m.recipientUid),
    ...(m.recipientEmail ? { recipientEmail: m.recipientEmail } : {}),
    ...(m.recipientName ? { recipientName: m.recipientName } : {}),
    text: m.text || '',
    createdAt: m.createdAt || m.timestamp || new Date().toISOString(),
    read: Boolean(m.read),
    ...(m.lessonRefId ? { lessonRefId: m.lessonRefId } : {}),
    ...(m.isNotice || m.isSystemNotice ? { isNotice: true } : {}),
  };
}

function filterAndSortPairMessages(
  all: any[],
  studentUid: string,
  nativeFriendUid: string
): DirectMessage[] {
  const filtered: DirectMessage[] = (all || [])
    .filter((m) => {
      if (!m || typeof m !== 'object') return false;
      const mStudent = normalizeUid(m.studentUid || m.receiverId || m.senderUid);
      const mTeacher = normalizeUid(m.nativeFriendUid || m.tutorUid || m.teacherUid);
      return (
        (mStudent === studentUid && mTeacher === nativeFriendUid) ||
        (normalizeUid(m.studentUid) === studentUid &&
          normalizeUid(m.nativeFriendUid || m.teacherUid || m.tutorUid) === nativeFriendUid)
      );
    })
    .map((m) => normalizeServerMessage(m, studentUid, nativeFriendUid));

  filtered.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime() || 0;
    const tb = new Date(b.createdAt).getTime() || 0;
    if (ta !== tb) return ta - tb;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  return filtered;
}

function notifyConversationListeners(cacheKey: string, messages: DirectMessage[]): void {
  const listeners = conversationListeners.get(cacheKey);
  if (!listeners || listeners.size === 0) return;
  listeners.forEach((cb) => {
    try {
      cb(messages);
    } catch (err) {
      console.warn('[directMessages] Listener error:', err);
    }
  });
}

/**
 * Subscribes to direct messages strictly between the student and their active Native Friend.
 * Reads exclusively from the authenticated backend (/api/chat-messages -> Firestore '(default)').
 */
export function subscribeDirectMessages(
  studentUid: string,
  nativeFriendUid: string,
  onUpdate: (messages: DirectMessage[]) => void
): () => void {
  const cleanStudent = normalizeUid(studentUid);
  const cleanNativeFriend = normalizeUid(nativeFriendUid);

  if (!cleanStudent || !cleanNativeFriend) {
    onUpdate([]);
    return () => {};
  }

  const cacheKey = `${cleanStudent}::${cleanNativeFriend}`;
  let isUnsubscribed = false;

  if (!conversationListeners.has(cacheKey)) {
    conversationListeners.set(cacheKey, new Set());
  }
  const safeListener = (msgs: DirectMessage[]) => {
    if (!isUnsubscribed) {
      onUpdate(msgs);
    }
  };
  conversationListeners.get(cacheKey)!.add(safeListener);

  // Helper to load initial in-memory cached messages for zero-flicker UI
  if (inMemoryDmCache.has(cacheKey)) {
    const cached = inMemoryDmCache.get(cacheKey) || [];
    if (cached.length > 0) {
      onUpdate(cached);
    }
  }

  // Initial fetch from authenticated backend API
  void fetchServerMessages(cleanStudent, cleanNativeFriend, safeListener);

  // Lightweight polling while subscribed so incoming messages arrive without client-side Firestore SDK
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  if (typeof setInterval === 'function') {
    pollTimer = setInterval(() => {
      if (!isUnsubscribed) {
        void fetchServerMessages(cleanStudent, cleanNativeFriend, safeListener);
      }
    }, POLL_INTERVAL_MS);
    if (typeof (pollTimer as any)?.unref === 'function') {
      (pollTimer as any).unref();
    }
  }

  return () => {
    isUnsubscribed = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    const set = conversationListeners.get(cacheKey);
    if (set) {
      set.delete(safeListener);
      if (set.size === 0) {
        conversationListeners.delete(cacheKey);
      }
    }
  };
}

async function fetchServerMessages(
  studentUid: string,
  nativeFriendUid: string,
  onUpdate: (messages: DirectMessage[]) => void
) {
  try {
    const token = await resolveBearerToken();
    if (!token) return;

    const res = await fetch('/api/chat-messages', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.ok) {
      const data = await res.json();
      const all: any[] = data.messages || [];
      const filtered = filterAndSortPairMessages(all, studentUid, nativeFriendUid);
      const cacheKey = `${studentUid}::${nativeFriendUid}`;
      inMemoryDmCache.set(cacheKey, filtered);
      onUpdate(filtered);
    }
  } catch (err) {
    console.warn('[directMessages] Failed to fetch messages from server:', err);
  }
}

/**
 * Sends an asynchronous direct message / notice strictly linked to the student and active Native Friend pair.
 * Persists exclusively via authenticated backend (/api/chat-messages -> Firestore '(default)').
 */
export async function sendDirectMessage(params: {
  studentUid: string;
  studentEmail: string;
  studentName?: string;
  nativeFriendUid: string;
  nativeFriendEmail: string;
  nativeFriendName?: string;
  nativeFriendAvatar?: string;
  senderUid: string;
  senderEmail: string;
  senderName: string;
  senderRole: 'student' | 'teacher' | 'admin' | 'system';
  recipientUid: string;
  text: string;
  lessonRefId?: string;
  isNotice?: boolean;
}): Promise<DirectMessage | null> {
  const cleanText = (params.text || '').trim();
  if (!cleanText) return null;

  const cleanStudent = normalizeUid(params.studentUid);
  const cleanNativeFriend = normalizeUid(params.nativeFriendUid);
  if (!cleanStudent || !cleanNativeFriend) return null;

  const msgId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const nowIso = new Date().toISOString();

  const message: DirectMessage = {
    id: msgId,
    studentUid: cleanStudent,
    studentEmail: params.studentEmail.toLowerCase().trim(),
    studentName: params.studentName || '',
    nativeFriendUid: cleanNativeFriend,
    nativeFriendEmail: params.nativeFriendEmail.toLowerCase().trim(),
    nativeFriendName: params.nativeFriendName || '',
    nativeFriendAvatar: params.nativeFriendAvatar || '',
    senderUid: normalizeUid(params.senderUid),
    senderEmail: params.senderEmail.toLowerCase().trim(),
    senderName: params.senderName || '',
    senderRole: params.senderRole,
    recipientUid: normalizeUid(params.recipientUid),
    recipientEmail: params.senderRole === 'student' ? params.nativeFriendEmail : params.studentEmail,
    recipientName: params.senderRole === 'student' ? params.nativeFriendName : params.studentName,
    text: cleanText.slice(0, 2000),
    createdAt: nowIso,
    read: false,
    ...(params.lessonRefId ? { lessonRefId: params.lessonRefId } : {}),
    ...(params.isNotice ? { isNotice: true } : {}),
  };

  try {
    const token = await resolveBearerToken();
    if (!token) {
      console.warn('[directMessages] Cannot send message without verified auth token.');
      return null;
    }

    const res = await fetch('/api/chat-messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message: {
          ...message,
          timestamp: nowIso,
        },
      }),
    });

    if (!res.ok) {
      console.warn(`[directMessages] Server rejected message ${msgId} with HTTP ${res.status}`);
      return null;
    }

    const data = await res.json().catch(() => ({}));
    const cacheKey = `${cleanStudent}::${cleanNativeFriend}`;

    let persistedList: DirectMessage[];
    if (Array.isArray(data?.messages)) {
      persistedList = filterAndSortPairMessages(data.messages, cleanStudent, cleanNativeFriend);
    } else {
      const existing = inMemoryDmCache.get(cacheKey) || [];
      persistedList = existing.some((m) => m.id === msgId) ? existing : [...existing, message];
    }

    const persistedMsg =
      (data?.message && normalizeServerMessage(data.message, cleanStudent, cleanNativeFriend)) ||
      persistedList.find((m) => m.id === msgId) ||
      message;

    inMemoryDmCache.set(cacheKey, persistedList);
    notifyConversationListeners(cacheKey, persistedList);
    return persistedMsg;
  } catch (err) {
    console.warn('[directMessages] Failed to send message to server:', err);
    return null;
  }
}

/**
 * Marks messages as read exclusively via authenticated backend (/api/chat-messages PATCH -> Firestore '(default)').
 */
export async function markDirectMessagesAsRead(messageIds: string[]): Promise<void> {
  if (!messageIds || messageIds.length === 0) return;

  const idsToMark = Array.from(
    new Set(messageIds.map((id) => String(id || '').trim()).filter(Boolean))
  ).filter((id) => !inFlightReadIds.has(id));

  if (idsToMark.length === 0) return;

  const token = await resolveBearerToken();
  if (!token) return;

  idsToMark.forEach((id) => inFlightReadIds.add(id));

  try {
    const res = await fetch('/api/chat-messages', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messageIds: idsToMark,
        read: true,
      }),
    });

    if (!res.ok) {
      console.warn(`[directMessages] Failed to mark messages as read: HTTP ${res.status}`);
      return;
    }

    const data = await res.json().catch(() => ({}));
    const markedSet = new Set(idsToMark);
    const serverMessages: any[] | null = Array.isArray(data?.messages) ? data.messages : null;

    inMemoryDmCache.forEach((list, cacheKey) => {
      if (serverMessages) {
        const [studentUid, nativeFriendUid] = cacheKey.split('::');
        if (studentUid && nativeFriendUid) {
          const updated = filterAndSortPairMessages(serverMessages, studentUid, nativeFriendUid);
          inMemoryDmCache.set(cacheKey, updated);
          notifyConversationListeners(cacheKey, updated);
          return;
        }
      }

      let changed = false;
      const updated = list.map((m) => {
        if (markedSet.has(m.id) && !m.read) {
          changed = true;
          return { ...m, read: true };
        }
        return m;
      });
      if (changed) {
        inMemoryDmCache.set(cacheKey, updated);
        notifyConversationListeners(cacheKey, updated);
      }
    });
  } catch (err) {
    console.warn('[directMessages] Failed to mark messages as read on server:', err);
  } finally {
    idsToMark.forEach((id) => inFlightReadIds.delete(id));
  }
}
