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

function normalizePedagogicalValue(value: any): any {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => normalizePedagogicalValue(item));
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      if (value[k] !== undefined) {
        out[k] = normalizePedagogicalValue(value[k]);
      }
    }
    return out;
  }
  return value;
}

/**
 * Compares two pedagogical transformation objects canonically (order-independent object keys).
 */
export function arePedagogicalTransformationsEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return JSON.stringify(normalizePedagogicalValue(a)) === JSON.stringify(normalizePedagogicalValue(b));
}


/**
 * Generates an opaque, unique revision token tied to the contentRevision counter.
 * Eliminates the ABA problem because every relevant edit increments contentRevision and adds fresh entropy.
 * Compatible with both browser (Vite) and Node.js runtimes.
 */
export function mintSessionNoteRevisionToken(contentRevision: number): string {
  let randomHex = '';
  try {
    const cryptoObj = (globalThis as any)?.crypto;
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      const bytes = new Uint8Array(12);
      cryptoObj.getRandomValues(bytes);
      randomHex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {}
  if (!randomHex) {
    randomHex = `${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`;
  }
  const safeRev = Number.isFinite(contentRevision) && contentRevision >= 1 ? Math.floor(contentRevision) : 1;
  return `rev_${safeRev}_${randomHex}`;
}

/**
 * Resolves the authoritative revision token for an existing document, deterministically
 * deriving a legacy token for pre-existing documents that have not yet been stamped.
 */
export function deriveLegacyRevisionToken(doc: any): string | null {
  if (!doc || typeof doc !== 'object') return null;
  if (typeof doc.revisionToken === 'string' && doc.revisionToken.trim().length > 0) {
    return doc.revisionToken.trim();
  }
  const ver = Number(doc.contentRevision || doc.currentVersionNumber || 1);
  const raw = String(doc.rawContent !== undefined ? doc.rawContent : (doc.content || ''));
  const topic = String(doc.topic || '');
  return `legacy_r${Number.isFinite(ver) && ver >= 1 ? Math.floor(ver) : 1}_${computeNotesContentHash(`${raw}\n::topic::\n${topic}`)}`;
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
 * - Monotonic contentRevision & opaque revisionToken on relevant rawContent/topic edits (anti-ABA)
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
  const resolvedTopic = incomingNote.topic || existingNote?.topic || 'Live Coaching Session';

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

  // 7. Revision Token & Content Revision (anti-ABA: always bump on rawContent, topic, draft, or approval change)
  let nextContentRevision: number;
  let nextRevisionToken: string;
  if (!existingNote) {
    nextContentRevision = 1;
    nextRevisionToken = mintSessionNoteRevisionToken(1);
  } else {
    const existingRaw = String(existingNote.rawContent !== undefined ? existingNote.rawContent : (existingNote.content || ''));
    const existingTopic = String(existingNote.topic || 'Live Coaching Session');
    const prevContentRevision = Number(existingNote.contentRevision || 1);
    const existingDraft = existingNote.draftTransformation || null;
    const existingApproved = existingNote.lastApprovedVersion || null;
    const draftChanged =
      Boolean(draftTransformation) !== Boolean(existingDraft) ||
      (Boolean(draftTransformation) &&
        Boolean(existingDraft) &&
        (draftTransformation!.draftId !== existingDraft!.draftId ||
          !arePedagogicalTransformationsEqual(draftTransformation!.transformation, existingDraft!.transformation) ||
          (draftTransformation!.customTeacherNotes ?? '') !== (existingDraft!.customTeacherNotes ?? '') ||
          (draftTransformation!.reviewNotes ?? '') !== (existingDraft!.reviewNotes ?? '')));
    const approvedChanged =
      Boolean(lastApprovedVersion) !== Boolean(existingApproved) ||
      (Boolean(lastApprovedVersion) &&
        Boolean(existingApproved) &&
        (lastApprovedVersion!.approvedVersionId !== existingApproved!.approvedVersionId ||
          lastApprovedVersion!.versionNumber !== existingApproved!.versionNumber ||
          !arePedagogicalTransformationsEqual(lastApprovedVersion!.transformation, existingApproved!.transformation)));
    const hasRelevantContentChange =
      rawContent !== existingRaw ||
      resolvedTopic !== existingTopic ||
      draftChanged ||
      approvedChanged;
    if (hasRelevantContentChange) {
      nextContentRevision = (Number.isFinite(prevContentRevision) && prevContentRevision >= 1 ? Math.floor(prevContentRevision) : 1) + 1;
      nextRevisionToken = mintSessionNoteRevisionToken(nextContentRevision);
    } else {
      nextContentRevision = Number.isFinite(prevContentRevision) && prevContentRevision >= 1 ? Math.floor(prevContentRevision) : 1;
      nextRevisionToken = deriveLegacyRevisionToken(existingNote) || mintSessionNoteRevisionToken(nextContentRevision);
    }
  }

  // 8. Assemble Complete Canonical Document
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
    topic: resolvedTopic,
    content: rawContent,
    rawContent,
    originalTeacherNotes,
    draftTransformation,
    lastApprovedVersion,
    approvalStatus,
    versionHistory: updatedVersionHistory,
    currentVersionNumber: finalEffectiveVersion,
    contentRevision: nextContentRevision,
    revisionToken: nextRevisionToken,
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
