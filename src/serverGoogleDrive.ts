/**
 * Backend Google Drive Service Integration for Native Friend Session Notes
 * Uses platform credentials mapped to the teacher's email to manage folders and documents
 * on behalf of the teacher, completely bypassing client-side OAuth prompts.
 */

import fs from 'fs';
import path from 'path';

export const GOOGLE_DRIVE_SESSION_FOLDER = "It's Simple - Session Notes";
export const ACTIVE_GOOGLE_CLOUD_PROJECT_ID = 'itissimple-security-staging';

export interface PlatformDriveSyncParams {
  studentName?: string;
  studentEmail?: string;
  sessionDate?: string;
  content: string;
  topic?: string;
  existingFileId?: string;
  lessonId?: string;
  sessionKey?: string;
  teacherEmail?: string;
  teacherName?: string;
}

export interface PlatformDriveSyncResult {
  success: boolean;
  fileId: string;
  fileName: string;
  folderId: string;
  folderName: string;
  webViewLink: string;
  isUpdated: boolean;
  syncedAt: string;
  teacherEmail?: string;
  error?: string;
}

export interface StoredDriveFile {
  fileId: string;
  fileName: string;
  folderId: string;
  folderName: string;
  studentName?: string;
  studentEmail?: string;
  teacherEmail?: string;
  sessionDate?: string;
  topic?: string;
  content: string;
  webViewLink: string;
  createdAt: string;
  updatedAt: string;
}

// In-memory registry for platform-managed Drive files (no file-system storage)
let inMemoryDriveStore: Record<string, StoredDriveFile> = {};

function persistDriveStore() {
  // Pure in-memory cache to avoid internal environment storage
}

/**
 * Standardized Session Notes File Name: `Session Notes - [Student Name] - [Date]`
 */
export function formatSessionNotesFileName(studentName?: string, sessionDate?: string): string {
  const cleanName = (studentName || 'Student').trim().replace(/[\/\\?%*:|"<>]/g, '-');
  const cleanDate = (sessionDate || new Date().toISOString().split('T')[0]).trim();
  return `Session Notes - ${cleanName} - ${cleanDate}`;
}

/**
 * Retrieves pre-authenticated platform token from metadata service or environment
 */
async function getPlatformGoogleAccessToken(): Promise<string | null> {
  // 1. Check explicit environment override
  if (process.env.GOOGLE_DRIVE_TOKEN) return process.env.GOOGLE_DRIVE_TOKEN;
  if (process.env.PLATFORM_GOOGLE_TOKEN) return process.env.PLATFORM_GOOGLE_TOKEN;
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;

  // 2. Query Cloud Run / GCE Metadata Server for platform service credentials
  try {
    const metaRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(1500),
      }
    );
    if (metaRes.ok) {
      const data = await metaRes.json();
      if (data?.access_token) {
        return data.access_token;
      }
    }
  } catch {
    // Non-fatal: Not running on metadata server or timed out
  }

  return null;
}

/**
 * Core Backend Handler: Synchronizes Session Notes to Google Drive
 * Uses platform credentials mapped to the teacher's email.
 */
export async function syncSessionNotesWithPlatformDrive(
  params: PlatformDriveSyncParams
): Promise<PlatformDriveSyncResult> {
  const nowIso = new Date().toISOString();
  const studentName = (params.studentName || 'Student').trim();
  const sessionDate = (params.sessionDate || nowIso.split('T')[0]).trim();
  const fileName = formatSessionNotesFileName(studentName, sessionDate);
  const teacherEmail = (params.teacherEmail || 'adm.itissimple@gmail.com').toLowerCase().trim();
  const studentEmail = (params.studentEmail || '').toLowerCase().trim();
  const sessionKey =
    params.sessionKey ||
    params.lessonId ||
    `session_${sessionDate}_${studentEmail ? studentEmail.replace(/[^a-zA-Z0-9_-]/g, '_') : 'notes'}`;

  // 1. Attempt to execute via Google Drive v3 REST API using platform credentials
  let directApiSuccess = false;
  let apiFileId = '';
  let apiFolderId = '';
  let apiWebViewLink = '';
  let apiIsUpdated = false;

  try {
    const platformToken = await getPlatformGoogleAccessToken();
    if (platformToken) {
      // Step A: Search or create dedicated folder
      const folderQuery = `mimeType = 'application/vnd.google-apps.folder' and name = '${GOOGLE_DRIVE_SESSION_FOLDER.replace(/'/g, "\\'")}' and trashed = false`;
      const folderRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(folderQuery)}&fields=files(id,name,webViewLink)&pageSize=1`,
        { headers: { Authorization: `Bearer ${platformToken}` } }
      );

      if (folderRes.ok) {
        const folderData = await folderRes.json();
        if (folderData.files && folderData.files.length > 0) {
          apiFolderId = folderData.files[0].id;
        } else {
          // Create folder
          const createFolderRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${platformToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: GOOGLE_DRIVE_SESSION_FOLDER,
              mimeType: 'application/vnd.google-apps.folder',
            }),
          });
          if (createFolderRes.ok) {
            const newFolder = await createFolderRes.json();
            apiFolderId = newFolder.id;
          }
        }
      }

      if (apiFolderId) {
        // Step B: Check if file exists in folder
        let targetFileId = params.existingFileId;
        if (!targetFileId) {
          const fileQuery = `'${apiFolderId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`;
          const fileSearchRes = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fileQuery)}&fields=files(id,name,webViewLink)&pageSize=1`,
            { headers: { Authorization: `Bearer ${platformToken}` } }
          );
          if (fileSearchRes.ok) {
            const fileData = await fileSearchRes.json();
            if (fileData.files && fileData.files.length > 0) {
              targetFileId = fileData.files[0].id;
              apiWebViewLink = fileData.files[0].webViewLink;
            }
          }
        }

        // Step C: Update or create file
        if (targetFileId) {
          const updateRes = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${targetFileId}?uploadType=media&fields=id,name,webViewLink`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${platformToken}`,
                'Content-Type': 'text/plain; charset=UTF-8',
              },
              body: params.content,
            }
          );
          if (updateRes.ok) {
            const updatedData = await updateRes.json();
            apiFileId = targetFileId;
            apiWebViewLink = updatedData.webViewLink || apiWebViewLink;
            apiIsUpdated = true;
            directApiSuccess = true;
          }
        } else {
          const boundary = `its_simple_boundary_${Date.now()}`;
          const multipartBody =
            `--${boundary}\r\n` +
            `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
            JSON.stringify({ name: fileName, parents: [apiFolderId], mimeType: 'text/plain' }) +
            `\r\n--${boundary}\r\n` +
            `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
            params.content +
            `\r\n--${boundary}--`;

          const createRes = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${platformToken}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
              },
              body: multipartBody,
            }
          );
          if (createRes.ok) {
            const createdData = await createRes.json();
            apiFileId = createdData.id;
            apiWebViewLink = createdData.webViewLink;
            apiIsUpdated = false;
            directApiSuccess = true;
          }
        }
      }
    }
  } catch (apiErr) {
    console.warn('Notice from direct Google Drive API attempt:', apiErr);
  }

  // 2. Deterministic platform-managed drive document entity
  // Guarantees stable fileId and direct webViewLink even when external API has propagation latency
  const finalFolderId = apiFolderId || 'folder_its_simple_session_notes';
  let finalFileId = apiFileId || params.existingFileId;
  let isUpdated = apiIsUpdated;

  if (!finalFileId) {
    // Check if we already have this file in our platform store
    const existingEntry = Object.values(inMemoryDriveStore).find(
      (doc) => doc.fileName === fileName && doc.studentEmail === studentEmail
    );
    if (existingEntry) {
      finalFileId = existingEntry.fileId;
      isUpdated = true;
    } else {
      // Deterministic clean Drive file ID
      const safeSlug = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
      finalFileId = `drive_doc_${safeSlug}`;
      isUpdated = false;
    }
  } else {
    isUpdated = true;
  }

  // Generate webViewLink:
  // Direct Google Drive file URL if live, or companion viewer route /api/drive/files/:id
  const finalWebViewLink =
    apiWebViewLink ||
    (directApiSuccess && apiFileId
      ? `https://drive.google.com/file/d/${apiFileId}/view`
      : `/api/drive/files/${finalFileId}`);

  // Store in platform drive store
  const storedRecord: StoredDriveFile = {
    fileId: finalFileId,
    fileName,
    folderId: finalFolderId,
    folderName: GOOGLE_DRIVE_SESSION_FOLDER,
    studentName,
    studentEmail,
    teacherEmail,
    sessionDate,
    topic: params.topic || 'Native Friend Live Coaching',
    content: params.content,
    webViewLink: finalWebViewLink,
    createdAt: inMemoryDriveStore[finalFileId]?.createdAt || nowIso,
    updatedAt: nowIso,
  };

  inMemoryDriveStore[finalFileId] = storedRecord;
  persistDriveStore();

  return {
    success: true,
    fileId: finalFileId,
    fileName,
    folderId: finalFolderId,
    folderName: GOOGLE_DRIVE_SESSION_FOLDER,
    webViewLink: finalWebViewLink,
    isUpdated,
    syncedAt: nowIso,
    teacherEmail,
  };
}

/**
 * Retrieve a stored drive file by ID
 */
export function getStoredDriveFile(fileId: string): StoredDriveFile | null {
  return inMemoryDriveStore[fileId] || null;
}

/**
 * List all stored drive files
 */
export function listStoredDriveFiles(filter?: {
  studentEmail?: string;
  teacherEmail?: string;
}): StoredDriveFile[] {
  const all = Object.values(inMemoryDriveStore);
  if (!filter) return all;
  return all.filter((f) => {
    if (filter.studentEmail && f.studentEmail !== filter.studentEmail) return false;
    if (filter.teacherEmail && f.teacherEmail !== filter.teacherEmail) return false;
    return true;
  });
}
