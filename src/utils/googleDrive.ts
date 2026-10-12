/**
 * Real Google Drive Integration for Teacher Session Notes
 * Saves and updates files directly into the personal Google Drive account
 * of the logged-in teacher inside the dedicated "It's Simple - Session Notes" folder,
 * using their authenticated OAuth 2.0 access token with scope https://www.googleapis.com/auth/drive.file.
 */

export const GOOGLE_DRIVE_SESSION_FOLDER = "It's Simple - Session Notes";
export const ACTIVE_GOOGLE_PROJECT_ID = 'itissimple-security-staging';

export interface DriveFolderResult {
  id: string;
  name: string;
  webViewLink?: string;
}

export interface DriveFileResult {
  id: string;
  name: string;
  webViewLink?: string;
  isUpdated?: boolean;
}

export interface SyncSessionNotesResult {
  success: boolean;
  fileId?: string;
  fileName?: string;
  folderId?: string;
  folderName?: string;
  webViewLink?: string;
  isUpdated?: boolean;
  requiresAuth?: boolean;
  error?: string;
}

/**
 * Escapes single quotes and backslashes for Google Drive query strings
 */
export function escapeDriveQueryString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Generate standardized clean filename: `Session Notes - [Student Name] - [Date]`
 */
export function formatSessionNotesFileName(studentName?: string, sessionDate?: string): string {
  const cleanName = (studentName || 'Student').trim().replace(/[\/\\?%*:|"<>]/g, '-');
  const cleanDate = (sessionDate || new Date().toISOString().split('T')[0]).trim();
  return `Session Notes - ${cleanName} - ${cleanDate}`;
}

/**
 * Checks for or creates the dedicated "It's Simple - Session Notes" folder in the teacher's personal Google Drive
 */
export async function getOrCreateSessionNotesFolder(accessToken: string): Promise<DriveFolderResult> {
  if (!accessToken) {
    throw new Error('Access token is required to access Google Drive.');
  }

  // 1. Search for existing folder
  const folderQuery = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeDriveQueryString(
    GOOGLE_DRIVE_SESSION_FOLDER
  )}' and trashed = false`;

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(folderQuery)}&fields=files(id,name,webViewLink)&pageSize=1`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (searchRes.status === 401) {
    const err: any = new Error('TOKEN_EXPIRED');
    err.status = 401;
    throw err;
  }

  if (!searchRes.ok) {
    const errData = await searchRes.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Failed to search folders (${searchRes.status})`);
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    const folder = searchData.files[0];
    return {
      id: folder.id,
      name: folder.name || GOOGLE_DRIVE_SESSION_FOLDER,
      webViewLink: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
    };
  }

  // 2. Folder does not exist, create it in root of teacher's Google Drive
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: GOOGLE_DRIVE_SESSION_FOLDER,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (createRes.status === 401) {
    const err: any = new Error('TOKEN_EXPIRED');
    err.status = 401;
    throw err;
  }

  if (!createRes.ok) {
    const errData = await createRes.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Failed to create folder (${createRes.status})`);
  }

  const newFolder = await createRes.json();
  return {
    id: newFolder.id,
    name: newFolder.name || GOOGLE_DRIVE_SESSION_FOLDER,
    webViewLink: newFolder.webViewLink || `https://drive.google.com/drive/folders/${newFolder.id}`,
  };
}

/**
 * Checks if a session notes document already exists in the teacher's folder
 */
export async function findExistingSessionNotesFile(
  accessToken: string,
  folderId: string,
  fileName: string
): Promise<DriveFileResult | null> {
  if (!accessToken || !folderId || !fileName) return null;

  try {
    const fileQuery = `'${folderId}' in parents and name = '${escapeDriveQueryString(fileName)}' and trashed = false`;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fileQuery)}&fields=files(id,name,webViewLink)&pageSize=1`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (res.status === 401) {
      const err: any = new Error('TOKEN_EXPIRED');
      err.status = 401;
      throw err;
    }

    if (!res.ok) return null;

    const data = await res.json();
    if (data.files && data.files.length > 0) {
      const f = data.files[0];
      return {
        id: f.id,
        name: f.name,
        webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
      };
    }
  } catch (err: any) {
    if (err.message === 'TOKEN_EXPIRED') throw err;
    console.warn('findExistingSessionNotesFile error:', err);
  }

  return null;
}

/**
 * Synchronizes session notes directly to the teacher's personal Google Drive:
 * 1. Checks or creates the folder "It's Simple - Session Notes" in their personal Google Drive
 * 2. Checks if the file "Session Notes - [Student Name] - [Session Date]" already exists in that folder
 * 3. Updates existing file or creates a new file directly in the teacher's Drive
 * 4. Returns real Google Drive file ID and webViewLink
 */
export async function syncSessionNotesToGoogleDrive(params: {
  accessToken: string;
  studentName?: string;
  studentEmail?: string;
  teacherEmail?: string;
  teacherName?: string;
  sessionDate?: string;
  topic?: string;
  content: string;
  existingFileId?: string;
  lessonId?: string;
  sessionKey?: string;
}): Promise<SyncSessionNotesResult> {
  const {
    accessToken,
    studentName = 'Student',
    sessionDate = new Date().toISOString().split('T')[0],
    content = '',
    existingFileId,
  } = params;

  if (!accessToken) {
    return {
      success: false,
      requiresAuth: true,
      error: 'Google Drive authorization is required. Please authenticate with Google.',
    };
  }

  try {
    // Step 1: Ensure dedicated folder exists in teacher's personal Google Drive
    const folder = await getOrCreateSessionNotesFolder(accessToken);
    const fileName = formatSessionNotesFileName(studentName, sessionDate);

    // Step 2: Determine if file already exists
    let targetFileId = existingFileId;
    let existingWebViewLink: string | undefined;

    if (targetFileId) {
      // Validate that existingFileId is reachable and not trashed
      try {
        const checkRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${targetFileId}?fields=id,name,webViewLink,trashed`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        if (checkRes.ok) {
          const fileData = await checkRes.json();
          if (fileData.trashed) {
            targetFileId = undefined;
          } else {
            existingWebViewLink = fileData.webViewLink;
          }
        } else if (checkRes.status === 404) {
          targetFileId = undefined;
        } else if (checkRes.status === 401) {
          throw new Error('TOKEN_EXPIRED');
        }
      } catch (checkErr: any) {
        if (checkErr.message === 'TOKEN_EXPIRED') throw checkErr;
        targetFileId = undefined;
      }
    }

    if (!targetFileId) {
      // Search folder for file with same name
      const existingFile = await findExistingSessionNotesFile(accessToken, folder.id, fileName);
      if (existingFile) {
        targetFileId = existingFile.id;
        existingWebViewLink = existingFile.webViewLink;
      }
    }

    // Step 3: Update existing file OR create new file in teacher's personal Drive
    if (targetFileId) {
      // Update file content
      const updateRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${targetFileId}?uploadType=media&fields=id,name,webViewLink`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'text/plain; charset=UTF-8',
          },
          body: content,
        }
      );

      if (updateRes.status === 401) {
        return {
          success: false,
          requiresAuth: true,
          error: 'Google Drive access token expired. Please re-authenticate.',
        };
      }

      if (!updateRes.ok) {
        const errData = await updateRes.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Failed to update file in Google Drive (${updateRes.status})`);
      }

      const updatedData = await updateRes.json();
      const finalLink =
        updatedData.webViewLink ||
        existingWebViewLink ||
        `https://drive.google.com/file/d/${targetFileId}/view`;

      return {
        success: true,
        fileId: targetFileId,
        fileName,
        folderId: folder.id,
        folderName: folder.name,
        webViewLink: finalLink,
        isUpdated: true,
      };
    } else {
      // Create new file inside the folder using multipart upload
      const boundary = `its_simple_boundary_${Date.now()}`;
      const multipartBody =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({
          name: fileName,
          parents: [folder.id],
          mimeType: 'text/plain',
        }) +
        `\r\n--${boundary}\r\n` +
        `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
        content +
        `\r\n--${boundary}--`;

      const createRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        }
      );

      if (createRes.status === 401) {
        return {
          success: false,
          requiresAuth: true,
          error: 'Google Drive access token expired. Please re-authenticate.',
        };
      }

      if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Failed to create file in Google Drive (${createRes.status})`);
      }

      const createdData = await createRes.json();
      const finalLink =
        createdData.webViewLink || `https://drive.google.com/file/d/${createdData.id}/view`;

      return {
        success: true,
        fileId: createdData.id,
        fileName,
        folderId: folder.id,
        folderName: folder.name,
        webViewLink: finalLink,
        isUpdated: false,
      };
    }
  } catch (err: any) {
    if (err.message === 'TOKEN_EXPIRED') {
      return {
        success: false,
        requiresAuth: true,
        error: 'Sua sessão do Google Drive expirou. Por favor, autorize novamente.',
      };
    }
    console.error('syncSessionNotesToGoogleDrive error:', err);
    return {
      success: false,
      error: err.message || 'Erro ao sincronizar com o Google Drive.',
    };
  }
}
