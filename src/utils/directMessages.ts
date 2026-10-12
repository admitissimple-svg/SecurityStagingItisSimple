import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { getDb, auth } from '../firebase';
import { DirectMessage } from '../types';
import { assertSafeFirestoreWrite, stampSchemaVersion } from './firestoreSchemaValidator';

// Pure in-memory session cache for non-blocking active session rendering
// ZERO dependency on localStorage: Cloud Firestore is the 100% persistent master
const inMemoryDmCache = new Map<string, DirectMessage[]>();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.warn('Firestore DirectMessages Notice:', JSON.stringify(errInfo));
}

export function normalizeUid(id?: string | null): string {
  if (!id) return '';
  return String(id).trim();
}

/**
 * Subscribes to direct messages strictly between the student and their active Native Friend.
 * Enforces complete pair isolation: (studentUid <-> activeNativeFriendUid).
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

  const cacheKey = `${cleanStudent}_${cleanNativeFriend}`;

  // Helper to load initial in-memory cached messages for zero-flicker UI
  if (inMemoryDmCache.has(cacheKey)) {
    const cached = inMemoryDmCache.get(cacheKey) || [];
    if (cached.length > 0) {
      onUpdate(cached);
    }
  }

  let unsubscribeFirestore: (() => void) | null = null;

  try {
    const db = getDb();
    const messagesCollection = collection(db, 'direct_messages');

    // Query messages partitioned by studentUid to avoid multi-field index requirements
    const q = query(messagesCollection, where('studentUid', '==', cleanStudent));

    unsubscribeFirestore = onSnapshot(
      q,
      (snapshot) => {
        const msgs: DirectMessage[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as DirectMessage;
          // STRICT EXCLUSIVITY CHECK: Must match the active Native Friend pair
          if (
            data &&
            normalizeUid(data.studentUid) === cleanStudent &&
            normalizeUid(data.nativeFriendUid) === cleanNativeFriend
          ) {
            msgs.push({
              ...data,
              id: docSnap.id || data.id,
            });
          }
        });

        // Sort chronologically ascending
        msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        // Cache in memory for instant active session access
        inMemoryDmCache.set(cacheKey, msgs);

        onUpdate(msgs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'direct_messages');
        // Fallback: poll server API if Firestore permission or network is restricted
        fetchServerMessages(cleanStudent, cleanNativeFriend, onUpdate);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'direct_messages');
    fetchServerMessages(cleanStudent, cleanNativeFriend, onUpdate);
  }

  // Also initial fetch from server API to ensure all messages are synchronized
  fetchServerMessages(cleanStudent, cleanNativeFriend, onUpdate);

  return () => {
    if (unsubscribeFirestore) {
      try {
        unsubscribeFirestore();
      } catch {}
    }
  };
}

async function fetchServerMessages(
  studentUid: string,
  nativeFriendUid: string,
  onUpdate: (messages: DirectMessage[]) => void
) {
  try {
    const res = await fetch('/api/chat-messages');
    if (res.ok) {
      const data = await res.json();
      const all: any[] = data.messages || [];
      const filtered: DirectMessage[] = all
        .filter((m) => {
          const mStudent = normalizeUid(m.studentUid || m.receiverId || m.senderUid);
          const mTeacher = normalizeUid(m.nativeFriendUid || m.tutorUid || m.teacherUid);
          return (
            (mStudent === studentUid && mTeacher === nativeFriendUid) ||
            (normalizeUid(m.studentUid) === studentUid && normalizeUid(m.nativeFriendUid) === nativeFriendUid)
          );
        })
        .map((m) => ({
          id: m.id || `msg-${Date.now()}`,
          studentUid: m.studentUid || studentUid,
          studentEmail: m.studentEmail || '',
          studentName: m.studentName || '',
          nativeFriendUid: m.nativeFriendUid || nativeFriendUid,
          nativeFriendEmail: m.nativeFriendEmail || '',
          nativeFriendName: m.nativeFriendName || '',
          nativeFriendAvatar: m.nativeFriendAvatar || '',
          senderUid: m.senderUid || '',
          senderEmail: m.senderEmail || '',
          senderName: m.senderName || '',
          senderRole: m.senderRole || 'student',
          recipientUid: m.recipientUid || '',
          text: m.text || '',
          createdAt: m.createdAt || m.timestamp || new Date().toISOString(),
          read: Boolean(m.read),
          isNotice: Boolean(m.isNotice || m.isSystemNotice),
        }));

      filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (filtered.length > 0) {
        onUpdate(filtered);
      }
    }
  } catch {}
}

/**
 * Sends an asynchronous direct message / notice strictly linked to the student and active Native Friend pair.
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

  // 1. Write to Firebase Firestore with schema validation
  try {
    const db = getDb();
    const docRef = doc(db, 'direct_messages', msgId);
    const stampedMessage = stampSchemaVersion(message);
    assertSafeFirestoreWrite(`direct_messages/${msgId}`, stampedMessage, undefined, true);
    await setDoc(docRef, stampedMessage, { merge: true });
  } catch (err) {
    console.error(`[Firestore Error] Failed to write direct message ${msgId}:`, err);
    handleFirestoreError(err, OperationType.WRITE, `direct_messages/${msgId}`);
  }

  // 2. Mirror write to Express Server backend API
  try {
    await fetch('/api/chat-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          ...message,
          timestamp: nowIso,
        },
      }),
    });
  } catch (err) {
    console.warn('Could not mirror message to server:', err);
  }

  // 3. Update in-memory session cache
  const cacheKey = `${cleanStudent}_${cleanNativeFriend}`;
  const list: DirectMessage[] = inMemoryDmCache.get(cacheKey) || [];
  if (!list.some((m) => m.id === msgId)) {
    inMemoryDmCache.set(cacheKey, [...list, message]);
  }

  return message;
}

/**
 * Marks messages as read in Firestore and backend.
 */
export async function markDirectMessagesAsRead(messageIds: string[]): Promise<void> {
  if (!messageIds || messageIds.length === 0) return;

  const db = getDb();
  for (const id of messageIds) {
    try {
      const docRef = doc(db, 'direct_messages', id);
      await setDoc(docRef, { read: true }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `direct_messages/${id}`);
    }
  }
}
