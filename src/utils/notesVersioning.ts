/**
 * FASE NF-DOC.2A — Canonical Contract & Versioning Engine
 * Native Friends Notes: Original Notes, Draft AI Transformation, Last Approved Version, and Version History
 *
 * Rules:
 * 1. IDENTITY INVIOLABLE (FASE IDENTITY-CRITICAL.2): Strict canonical studentUid & teacherUid.
 *    No fallback to email or public tutor ID. Divergence fails explicitly.
 * 2. PRESERVATION: A new edit MUST NOT erase or unpublish the previously approved version.
 * 3. LEGACY COMPATIBILITY: Legacy records are not automatically approved (approvalStatus = 'unapproved').
 * 4. COMPLETE AUDIT: Versions appended sequentially with immutable timestamps, authorUid, and content hashes.
 */

import {
  SessionNotesDocument,
  TeacherOriginalNotes,
  NoteDraftTransformation,
  NoteApprovedVersion,
  SessionNoteVersionEntry,
} from '../types';

/**
 * Computes deterministic string hash for notes version comparison
 */
export function computeNotesContentHash(str: string): string {
  let hash = 0;
  const clean = (str || '').trim();
  for (let i = 0; i < clean.length; i++) {
    const char = clean.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export interface AuthorIdentityContext {
  authorUid: string;
  authorEmail?: string;
  authorRole: 'teacher' | 'admin';
  teacherName?: string;
}

export interface MergeSessionNoteOptions {
  existingNote?: SessionNotesDocument | null;
  incomingNote: Partial<SessionNotesDocument> & {
    content?: string;
    rawContent?: string;
    studentUid: string;
    teacherUid: string;
    sessionDate: string;
  };
  author: AuthorIdentityContext;
  changeSummary?: string;
}

/**
 * Merges incoming session note data into canonical versioned document while strictly enforcing:
 * - Preservation of previous approved version (editing raw notes or drafting does NOT unpublish)
 * - Immutability of studentUid and teacherUid
 * - No automatic approval for legacy content
 * - Monotonic version increment in versionHistory
 */
export function mergeSessionNoteWithVersioning(options: MergeSessionNoteOptions): SessionNotesDocument {
  const { existingNote, incomingNote, author, changeSummary } = options;

  // 1. Strict Identity Validation (FASE IDENTITY-CRITICAL.2)
  if (!incomingNote.studentUid || !incomingNote.studentUid.trim()) {
    throw new Error('CANONICAL_STUDENT_UID_REQUIRED: studentUid is mandatory for note versioning.');
  }
  if (!incomingNote.teacherUid || !incomingNote.teacherUid.trim()) {
    throw new Error('CANONICAL_TEACHER_UID_REQUIRED: teacherUid is mandatory for note versioning.');
  }

  if (existingNote) {
    if (existingNote.studentUid && existingNote.studentUid !== incomingNote.studentUid) {
      throw new Error(`CANONICAL_IDENTITY_MISMATCH: Existing note belongs to student ${existingNote.studentUid}, incoming has ${incomingNote.studentUid}`);
    }
    // Teacher can be changed only if authorized admin performs re-assignment
    if (existingNote.teacherUid && existingNote.teacherUid !== incomingNote.teacherUid && author.authorRole !== 'admin') {
      throw new Error(`CANONICAL_IDENTITY_MISMATCH: Teacher ${author.authorUid} is not authorized to overwrite note owned by teacher ${existingNote.teacherUid}`);
    }
  }

  const nowIso = new Date().toISOString();
  const rawContent = (incomingNote.rawContent !== undefined ? incomingNote.rawContent : incomingNote.content) || '';
  const contentHash = computeNotesContentHash(rawContent);

  const cleanSessionDate = incomingNote.sessionDate;
  const canonicalId = incomingNote.id || incomingNote.sessionKey || incomingNote.sessionId || existingNote?.id || `session_${cleanSessionDate}_${incomingNote.studentUid}`;
  const lessonId = incomingNote.lessonId || existingNote?.lessonId || '';

  // 2. Track Original Notes
  let originalTeacherNotes: TeacherOriginalNotes;
  if (existingNote?.originalTeacherNotes) {
    originalTeacherNotes = { ...existingNote.originalTeacherNotes };
  } else {
    // If existing note had raw content, capture it as original baseline; otherwise capture incoming
    const baselineContent = existingNote?.rawContent || existingNote?.content || rawContent;
    originalTeacherNotes = {
      rawContent: baselineContent,
      topic: existingNote?.topic || incomingNote.topic || '',
      updatedAt: existingNote?.createdAt || existingNote?.updatedAt || nowIso,
      savedByUid: existingNote?.teacherUid || incomingNote.teacherUid,
      teacherEmail: existingNote?.teacherEmail || incomingNote.teacherEmail || author.authorEmail || '',
      teacherName: existingNote?.teacherName || incomingNote.teacherName || author.teacherName || 'Native Friend',
      contentHash: computeNotesContentHash(baselineContent),
    };
  }

  // 3. Last Approved Version Preservation (INVIOLABLE: never erased or unpublished by raw edit)
  let lastApprovedVersion: NoteApprovedVersion | null = null;
  if (incomingNote.lastApprovedVersion) {
    // Explicit approval action
    lastApprovedVersion = { ...incomingNote.lastApprovedVersion };
  } else if (existingNote?.lastApprovedVersion) {
    // Retain previously approved version intact!
    lastApprovedVersion = { ...existingNote.lastApprovedVersion };
  }

  // 4. Draft Transformation
  let draftTransformation: NoteDraftTransformation | null = null;
  if (incomingNote.draftTransformation !== undefined) {
    draftTransformation = incomingNote.draftTransformation ? { ...incomingNote.draftTransformation } : null;
  } else if (existingNote?.draftTransformation) {
    draftTransformation = { ...existingNote.draftTransformation };
  }

  // 5. Approval Status (Never automatically approve legacy content)
  let approvalStatus: 'unapproved' | 'draft_in_progress' | 'approved' = 'unapproved';
  if (lastApprovedVersion) {
    approvalStatus = 'approved';
  } else if (draftTransformation) {
    approvalStatus = 'draft_in_progress';
  } else if (existingNote?.approvalStatus) {
    approvalStatus = existingNote.approvalStatus;
  }

  // 6. Version History
  const existingHistory: SessionNoteVersionEntry[] = Array.isArray(existingNote?.versionHistory)
    ? [...existingNote.versionHistory]
    : [];

  const currentVersionNumber = existingHistory.length > 0
    ? Math.max(...existingHistory.map((v) => v.versionNumber || 0))
    : 0;

  const nextVersionNumber = currentVersionNumber + 1;

  // Determine what type of version entry to append
  let newVersionEntry: SessionNoteVersionEntry | null = null;

  if (incomingNote.lastApprovedVersion && (!existingNote?.lastApprovedVersion || incomingNote.lastApprovedVersion.approvedVersionId !== existingNote.lastApprovedVersion.approvedVersionId)) {
    newVersionEntry = {
      versionId: `v_appr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      versionNumber: nextVersionNumber,
      type: 'approved_published',
      createdAt: nowIso,
      authorUid: author.authorUid,
      authorEmail: author.authorEmail,
      authorRole: author.authorRole,
      contentHash: incomingNote.lastApprovedVersion.contentHash || contentHash,
      rawContent,
      transformation: incomingNote.lastApprovedVersion.transformation,
      changeSummary: changeSummary || 'Teacher approved and published transformation for student',
    };
  } else if (incomingNote.draftTransformation && (!existingNote?.draftTransformation || incomingNote.draftTransformation.draftId !== existingNote.draftTransformation.draftId)) {
    newVersionEntry = {
      versionId: `v_draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      versionNumber: nextVersionNumber,
      type: 'ai_draft',
      createdAt: nowIso,
      authorUid: author.authorUid,
      authorEmail: author.authorEmail,
      authorRole: author.authorRole,
      contentHash: incomingNote.draftTransformation.contentHash || contentHash,
      rawContent,
      transformation: incomingNote.draftTransformation.transformation,
      changeSummary: changeSummary || 'Teacher updated draft AI transformation in progress',
    };
  } else {
    // Raw teacher notes update: check if content changed from previous recorded version
    const lastVersion = existingHistory[existingHistory.length - 1];
    const isFirstVersion = existingHistory.length === 0;
    const hasContentChanged = !lastVersion || lastVersion.contentHash !== contentHash || lastVersion.rawContent !== rawContent;

    if (isFirstVersion || hasContentChanged) {
      newVersionEntry = {
        versionId: `v_raw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        versionNumber: nextVersionNumber,
        type: 'teacher_raw',
        createdAt: nowIso,
        authorUid: author.authorUid,
        authorEmail: author.authorEmail,
        authorRole: author.authorRole,
        contentHash,
        rawContent,
        changeSummary: changeSummary || (isFirstVersion ? 'Initial teacher live notes' : 'Teacher updated live notes content'),
      };
    }
  }

  const updatedVersionHistory = newVersionEntry
    ? [...existingHistory, newVersionEntry]
    : existingHistory;

  const finalEffectiveVersion = updatedVersionHistory.length > 0
    ? Math.max(...updatedVersionHistory.map((v) => v.versionNumber || 0))
    : 1;

  // 7. Assemble Complete Canonical Document
  const resultDoc: SessionNotesDocument = {
    id: canonicalId,
    sessionId: canonicalId,
    sessionKey: canonicalId,
    sessionDate: cleanSessionDate,
    lessonId,
    studentUid: incomingNote.studentUid,
    studentEmail: incomingNote.studentEmail || existingNote?.studentEmail || '',
    teacherUid: incomingNote.teacherUid,
    teacherEmail: incomingNote.teacherEmail || existingNote?.teacherEmail || author.authorEmail || '',
    teacherName: incomingNote.teacherName || existingNote?.teacherName || author.teacherName || 'Native Friend',
    topic: incomingNote.topic || existingNote?.topic || 'Live Coaching Session',
    content: rawContent,
    rawContent,
    originalTeacherNotes,
    draftTransformation,
    lastApprovedVersion,
    approvalStatus,
    versionHistory: updatedVersionHistory,
    currentVersionNumber: finalEffectiveVersion,
    driveFileId: incomingNote.driveFileId || existingNote?.driveFileId || '',
    driveFileUrl: incomingNote.driveFileUrl || existingNote?.driveFileUrl || '',
    driveFolderName: incomingNote.driveFolderName || existingNote?.driveFolderName || 'Native Friends Notes',
    driveLastSyncedAt: incomingNote.driveLastSyncedAt || existingNote?.driveLastSyncedAt || '',
    createdAt: existingNote?.createdAt || nowIso,
    updatedAt: nowIso,
    lastSavedByUid: author.authorUid,
    pronunciationNotes: incomingNote.pronunciationNotes !== undefined ? incomingNote.pronunciationNotes : existingNote?.pronunciationNotes,
    grammarAndPhrasing: incomingNote.grammarAndPhrasing !== undefined ? incomingNote.grammarAndPhrasing : existingNote?.grammarAndPhrasing,
    vocabularyNotes: incomingNote.vocabularyNotes !== undefined ? incomingNote.vocabularyNotes : existingNote?.vocabularyNotes,
  };

  return resultDoc;
}
