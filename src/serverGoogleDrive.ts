export const GOOGLE_DRIVE_SESSION_FOLDER = 'itissimple_session_notes';

export function formatSessionNotesFileName(studentEmail: string, date: string): string {
  const cleanEmail = (studentEmail || 'student').replace(/[^a-zA-Z0-9]/g, '_');
  return `session_notes_${cleanEmail}_${date}.pdf`;
}

export async function syncSessionNotesWithPlatformDrive(filePayload: any): Promise<{ success: boolean; fileId?: string }> {
  return { success: true, fileId: 'mock-drive-file-id' };
}

export async function getStoredDriveFile(fileId: string): Promise<any> {
  return null;
}

export async function listStoredDriveFiles(): Promise<any[]> {
  return [];
}
