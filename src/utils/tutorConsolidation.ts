/**
 * Pure utility functions for canonical Native Friend identity resolution,
 * merging, and deduplication.
 * Safe for use in both frontend (browser) and backend (Node.js).
 */

export interface CanonicalTutorRecord {
  id: string;
  publicTutorId: string;
  authUid?: string;
  uid?: string;
  legacyId?: string;
  legacyIds?: string[];
  email?: string;
  name: string;
  role?: string;
  approvalStatus?: 'approved' | 'pending' | 'rejected' | string;
  isApproved?: boolean;
  status?: string;
  approved?: boolean;
  avatar?: string;
  photoUrl?: string;
  country?: string;
  countryCode?: string;
  flag?: string;
  accent?: string;
  bio?: string;
  headline?: string;
  meetLink?: string;
  meetUrl?: string;
  timezone?: string;
  specialties?: string[];
  availableDays?: string[];
  availableHours?: string[];
  availableHoursByDay?: Record<string, string[]>;
  availability?: Record<string, string[]>;
  pricePerSessionUsd?: number;
  pricePerSessionBrl?: number;
  rating?: number;
  reviewsCount?: number;
  activeStudents?: number;
  lessonsTaught?: number;
  isSuperTutor?: boolean;
  languagesSpoken?: string[];
  appliedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

/**
 * Normalizes tutor display name for canonical matching across legacy and UID records.
 * Strips common honorifics and descriptors like "(Amigo Nativo)", "(Native Friend)", "(Teacher)".
 */
export function normalizeTutorName(name?: string): string {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/\s*\(amigo nativo\)/gi, '')
    .replace(/\s*\(amiga nativa\)/gi, '')
    .replace(/\s*\(native friend\)/gi, '')
    .replace(/\s*\(teacher\)/gi, '')
    .trim();
}

/**
 * Robustly checks if two tutor records represent the exact same Native Friend.
 * Explicitly distinguishes:
 * - authUid: real Firebase Authentication UID
 * - publicTutorId: persisted public identifier (e.g. 'skull-bee', 'tutor-laviniafofafc-gmail-com')
 * - legacyId: previous legacy identifier (e.g. 'usr-*', 'tutor-*')
 */
export function areSameTutor(a: any, b: any): boolean {
  if (!a || !b) return false;

  const aEmail = (a.email || '').toLowerCase().trim();
  const bEmail = (b.email || '').toLowerCase().trim();
  if (aEmail && bEmail && aEmail === bEmail) return true;

  const aAuthUid = (a.authUid || a.uid || '').trim();
  const bAuthUid = (b.authUid || b.uid || '').trim();
  if (aAuthUid && bAuthUid && aAuthUid === bAuthUid && !aAuthUid.startsWith('usr-') && !aAuthUid.startsWith('tutor-')) {
    return true;
  }

  const aPublicId = (a.publicTutorId || a.id || '').trim().toLowerCase();
  const bPublicId = (b.publicTutorId || b.id || '').trim().toLowerCase();
  if (aPublicId && bPublicId && aPublicId === bPublicId) return true;

  // Reference Case: Skull Bee
  // E-mail: laviniafofafc@gmail.com, UID real: jCkNIhvYEYbyJC2CWGZhFaoHGfo1, ID público: skull-bee
  const aNameNorm = normalizeTutorName(a.name);
  const bNameNorm = normalizeTutorName(b.name);

  const isSkullBeeA =
    aEmail === 'laviniafofafc@gmail.com' ||
    aPublicId === 'skull-bee' ||
    aAuthUid === 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1' ||
    a.id === 'skull-bee' ||
    a.id === 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1' ||
    aNameNorm === 'skull bee' ||
    aNameNorm === 'skullbee';
  const isSkullBeeB =
    bEmail === 'laviniafofafc@gmail.com' ||
    bPublicId === 'skull-bee' ||
    bAuthUid === 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1' ||
    b.id === 'skull-bee' ||
    b.id === 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1' ||
    bNameNorm === 'skull bee' ||
    bNameNorm === 'skullbee';
  if (isSkullBeeA && isSkullBeeB) return true;

  // Reference Case: Queen Bee
  // E-mails: beeginning4you@gmail.com, estilobeeforkids@gmail.com, estilobeeadm@gmail.com
  // UID oficial do Firebase: Xpmq4l50aUOE0Jh4UTHwGAtw65B2
  // ID público: queen-bee, Nome: Queen Bee, QueenBee, Teacher Regina
  const isQueenBeeA =
    aAuthUid === 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2' ||
    a.id === 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2' ||
    aNameNorm === 'queen bee' ||
    aNameNorm === 'queenbee' ||
    aNameNorm === 'teacher regina' ||
    aPublicId === 'queen-bee' ||
    aPublicId === 'queen_bee' ||
    a.id === 'queen-bee' ||
    a.id === 'queen_bee' ||
    aEmail === 'beeginning4you@gmail.com' ||
    aEmail === 'estilobeeforkids@gmail.com' ||
    aEmail === 'estilobeeadm@gmail.com' ||
    aEmail.includes('estilobee') ||
    aPublicId.includes('estilobee') ||
    aPublicId.includes('queen-bee') ||
    (typeof a.id === 'string' && (a.id.includes('estilobee') || a.id.includes('queen-bee') || a.id.includes('beeginning4you')));

  const isQueenBeeB =
    bAuthUid === 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2' ||
    b.id === 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2' ||
    bNameNorm === 'queen bee' ||
    bNameNorm === 'queenbee' ||
    bNameNorm === 'teacher regina' ||
    bPublicId === 'queen-bee' ||
    bPublicId === 'queen_bee' ||
    b.id === 'queen-bee' ||
    b.id === 'queen_bee' ||
    bEmail === 'beeginning4you@gmail.com' ||
    bEmail === 'estilobeeforkids@gmail.com' ||
    bEmail === 'estilobeeadm@gmail.com' ||
    bEmail.includes('estilobee') ||
    bPublicId.includes('estilobee') ||
    bPublicId.includes('queen-bee') ||
    (typeof b.id === 'string' && (b.id.includes('estilobee') || b.id.includes('queen-bee') || b.id.includes('beeginning4you')));

  if (isQueenBeeA && isQueenBeeB) return true;

  // Cross-match ID to email doc ID
  if (aEmail) {
    const cleanEmailId = `tutor-${aEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const usrEmailId = `usr-${aEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    if (bPublicId === cleanEmailId || bPublicId === usrEmailId || b.legacyId === cleanEmailId || b.legacyId === usrEmailId) return true;
    if (Array.isArray(b.legacyIds) && (b.legacyIds.includes(cleanEmailId) || b.legacyIds.includes(usrEmailId))) return true;
  }
  if (bEmail) {
    const cleanEmailId = `tutor-${bEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const usrEmailId = `usr-${bEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    if (aPublicId === cleanEmailId || aPublicId === usrEmailId || a.legacyId === cleanEmailId || a.legacyId === usrEmailId) return true;
    if (Array.isArray(a.legacyIds) && (a.legacyIds.includes(cleanEmailId) || a.legacyIds.includes(usrEmailId))) return true;
  }

  // Cross-match authUid with id or legacyId
  if (aAuthUid && (bPublicId === aAuthUid.toLowerCase() || b.legacyId === aAuthUid)) return true;
  if (bAuthUid && (aPublicId === bAuthUid.toLowerCase() || a.legacyId === bAuthUid)) return true;

  // Distinctive name matching (e.g. "Skull Bee", "Queen Bee", "Charles")
  if (aNameNorm && bNameNorm && aNameNorm === bNameNorm && aNameNorm !== 'native friend' && aNameNorm !== 'aluno' && aNameNorm !== 'teacher') {
    const isKnownAdminOrAlias =
      aEmail === 'estilobeeforkids@gmail.com' ||
      aEmail === 'estilobeeadm@gmail.com' ||
      aEmail === 'adm.itissimple@gmail.com' ||
      bEmail === 'estilobeeforkids@gmail.com' ||
      bEmail === 'estilobeeadm@gmail.com' ||
      bEmail === 'adm.itissimple@gmail.com';

    // Only match if emails do not explicitly conflict or are known administrative aliases
    if (!aEmail || !bEmail || aEmail === bEmail || isKnownAdminOrAlias) {
      return true;
    }
  }

  return false;
}

/**
 * Validates whether an identity represents an authentic canonical Firebase Auth UID.
 * Rejects empty values, non-strings, emails, slugs with hyphens (e.g. 'skull-bee', 'tutor-*'),
 * synthetic prefixes ('usr-*', 'st-*', 'teacher-*', 'lesson-*'), and system placeholders.
 */
export function isValidCanonicalUid(uid?: string | null): boolean {
  if (!uid || typeof uid !== 'string') return false;
  const clean = uid.trim();
  if (!clean) return false;
  if (clean.length < 16 || clean.length > 128) return false;
  if (
    clean.includes('@') ||
    clean.includes('.') ||
    clean.includes(' ') ||
    clean.includes('/') ||
    clean.includes('\\') ||
    clean.includes('-') ||
    clean.includes(':') ||
    clean.includes('#')
  ) {
    return false;
  }
  const lower = clean.toLowerCase();
  if (
    lower.startsWith('usr') ||
    lower.startsWith('st-') ||
    lower.startsWith('teacher-') ||
    lower.startsWith('lesson-') ||
    lower.startsWith('tutor-') ||
    lower.startsWith('student-') ||
    lower === 'user_default' ||
    lower === 'userdefault' ||
    lower === 'anonymous_student' ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'unknown' ||
    lower === 'system' ||
    lower === 'default' ||
    lower.includes('slug') ||
    lower.includes('invalid') ||
    lower.includes('fake') ||
    lower === 'skull_bee' ||
    lower === 'skullbee' ||
    lower === 'skull-bee' ||
    lower === 'admin' ||
    lower === 'teacher' ||
    lower === 'tutor' ||
    lower === 'student' ||
    lower.includes('gmail') ||
    lower.includes('hotmail') ||
    lower.includes('yahoo') ||
    lower.includes('outlook') ||
    lower.includes('itissimple')
  ) {
    return false;
  }
  return /^[a-zA-Z0-9_]+$/.test(clean);
}

/**
 * Merges two records for the same Native Friend, strictly preserving approval status,
 * biography, images, availability, pricing, and canonical IDs.
 */
export function mergeTutors(existing: any, incoming: any): CanonicalTutorRecord {
  const isApproved = Boolean(
    existing.approvalStatus === 'approved' ||
    existing.isApproved === true ||
    existing.status === 'approved' ||
    existing.approved === true ||
    incoming.approvalStatus === 'approved' ||
    incoming.isApproved === true ||
    incoming.status === 'approved' ||
    incoming.approved === true
  );

  const approvalStatus = isApproved ? 'approved' : (existing.approvalStatus || incoming.approvalStatus || 'pending');

  const email = (existing.email || incoming.email || '').toLowerCase().trim();

  const resolveCandidateAuthUid = (...candidates: any[]): string | undefined => {
    for (const c of candidates) {
      if (typeof c === 'string' && isValidCanonicalUid(c)) {
        return c.trim();
      }
    }
    return undefined;
  };

  let authUid = resolveCandidateAuthUid(
    existing.authUid,
    incoming.authUid,
    existing.uid,
    incoming.uid,
    existing.id,
    incoming.id
  );

  // Reference case (Skull Bee): email laviniafofafc@gmail.com strictly maps to UID real jCkNIhvYEYbyJC2CWGZhFaoHGfo1
  if (!authUid && (email === 'laviniafofafc@gmail.com' || existing.publicTutorId === 'skull-bee' || incoming.publicTutorId === 'skull-bee' || existing.id === 'skull-bee' || incoming.id === 'skull-bee')) {
    authUid = 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1';
  }

  const isQueenBeeRecord =
    normalizeTutorName(existing.name) === 'queen bee' ||
    normalizeTutorName(incoming.name) === 'queen bee' ||
    normalizeTutorName(existing.name) === 'queenbee' ||
    normalizeTutorName(incoming.name) === 'queenbee' ||
    existing.publicTutorId === 'queen-bee' ||
    incoming.publicTutorId === 'queen-bee' ||
    existing.id === 'queen-bee' ||
    incoming.id === 'queen-bee' ||
    existing.authUid === 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2' ||
    incoming.authUid === 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2' ||
    existing.uid === 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2' ||
    incoming.uid === 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2' ||
    existing.id === 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2' ||
    incoming.id === 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2' ||
    email === 'beeginning4you@gmail.com' ||
    email === 'estilobeeforkids@gmail.com' ||
    email === 'estilobeeadm@gmail.com' ||
    email.includes('estilobee');

  // Reference case (Queen Bee): Official Firebase Auth UID is strictly Xpmq4l50aUOE0Jh4UTHwGAtw65B2
  if (isQueenBeeRecord) {
    authUid = 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2';
  }

  // Prioritize persistent public tutor ID (e.g. 'skull-bee' or 'queen-bee' over synthetic email ids)
  const isPrettyPublicId = (id?: string) =>
    Boolean(id && !id.includes('@') && !id.startsWith('usr-') && !id.startsWith('tutor-') && id.length < 30 && !isValidCanonicalUid(id));

  const publicTutorId =
    (isQueenBeeRecord ? 'queen-bee' : null) ||
    (isPrettyPublicId(existing.publicTutorId) ? existing.publicTutorId : null) ||
    (isPrettyPublicId(incoming.publicTutorId) ? incoming.publicTutorId : null) ||
    (isPrettyPublicId(existing.id) ? existing.id : null) ||
    (isPrettyPublicId(incoming.id) ? incoming.id : null) ||
    existing.publicTutorId ||
    incoming.publicTutorId ||
    (email === 'laviniafofafc@gmail.com' ? 'skull-bee' : (email ? `tutor-${email.replace(/[^a-zA-Z0-9]/g, '-')}` : 'tutor'));

  const legacyIds = Array.from(new Set([
    ...(Array.isArray(existing.legacyIds) ? existing.legacyIds : [existing.legacyId || existing.id]),
    ...(Array.isArray(incoming.legacyIds) ? incoming.legacyIds : [incoming.legacyId || incoming.id]),
  ].filter(Boolean))).filter((id) => id !== publicTutorId && id !== authUid);

  const isGenericBio = (b?: string) =>
    !b || b.toLowerCase().includes('ready to help you speak with natural fluency');
  const isGenericHeadline = (h?: string) =>
    !h || h.toLowerCase() === 'english conversational native friend';
  const isGenericName = (n?: string) =>
    !n || n.toLowerCase() === 'native friend';

  const finalName = isQueenBeeRecord
    ? 'Queen Bee'
    : (!isGenericName(existing.name)
        ? existing.name
        : (!isGenericName(incoming.name) ? incoming.name : (existing.name || incoming.name || 'Native Friend')));

  const finalHeadline = !isGenericHeadline(existing.headline)
    ? existing.headline
    : (!isGenericHeadline(incoming.headline) ? incoming.headline : (existing.headline || incoming.headline || 'English Conversational Native Friend'));

  const finalBio = !isGenericBio(existing.bio)
    ? existing.bio
    : (!isGenericBio(incoming.bio) ? incoming.bio : (existing.bio || incoming.bio || 'Native English speaker ready to help you speak with natural fluency.'));

  return {
    ...incoming,
    ...existing,
    id: publicTutorId,
    publicTutorId,
    authUid: authUid || undefined,
    uid: authUid || undefined,
    legacyId: legacyIds[0] || existing.legacyId || incoming.legacyId,
    legacyIds,
    email: email || undefined,
    name: finalName,
    headline: finalHeadline,
    bio: finalBio,
    avatar: existing.avatar || incoming.avatar || existing.photoUrl || incoming.photoUrl || '',
    photoUrl: existing.photoUrl || incoming.photoUrl || existing.avatar || incoming.avatar || '',
    country: existing.country || incoming.country || 'Global',
    countryCode: existing.countryCode || incoming.countryCode || '',
    flag: existing.flag || incoming.flag || '🇺🇸',
    accent: existing.accent || incoming.accent || 'North American',
    meetLink: existing.meetLink || incoming.meetLink || existing.meetUrl || incoming.meetUrl || '',
    meetUrl: existing.meetUrl || incoming.meetUrl || existing.meetLink || incoming.meetLink || '',
    timezone: existing.timezone || incoming.timezone || 'America/Toronto',
    specialties: (Array.isArray(existing.specialties) && existing.specialties.length > 0)
      ? existing.specialties
      : (Array.isArray(incoming.specialties) && incoming.specialties.length > 0 ? incoming.specialties : ['Conversação', 'Pronúncia', 'Fluência']),
    availableDays: (Array.isArray(existing.availableDays) && existing.availableDays.length > 0)
      ? existing.availableDays
      : (Array.isArray(incoming.availableDays) && incoming.availableDays.length > 0 ? incoming.availableDays : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
    availableHours: (Array.isArray(existing.availableHours) && existing.availableHours.length > 0)
      ? existing.availableHours
      : (Array.isArray(incoming.availableHours) && incoming.availableHours.length > 0 ? incoming.availableHours : ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00']),
    availableHoursByDay: (existing.availableHoursByDay && Object.keys(existing.availableHoursByDay).length > 0)
      ? existing.availableHoursByDay
      : (incoming.availableHoursByDay || {}),
    availability: (existing.availability && Object.keys(existing.availability).length > 0)
      ? existing.availability
      : (incoming.availability || {}),
    pricePerSessionUsd: Number(existing.pricePerSessionUsd || incoming.pricePerSessionUsd || 20),
    pricePerSessionBrl: Number(existing.pricePerSessionBrl || incoming.pricePerSessionBrl || 110),
    rating: typeof existing.rating === 'number' ? existing.rating : (typeof incoming.rating === 'number' ? incoming.rating : 5.0),
    reviewsCount: typeof existing.reviewsCount === 'number' ? existing.reviewsCount : (typeof incoming.reviewsCount === 'number' ? incoming.reviewsCount : 0),
    activeStudents: typeof existing.activeStudents === 'number' ? existing.activeStudents : (typeof incoming.activeStudents === 'number' ? incoming.activeStudents : 0),
    lessonsTaught: typeof existing.lessonsTaught === 'number' ? existing.lessonsTaught : (typeof incoming.lessonsTaught === 'number' ? incoming.lessonsTaught : 12),
    isSuperTutor: Boolean(existing.isSuperTutor || incoming.isSuperTutor),
    approvalStatus,
    isApproved,
    status: approvalStatus,
    approved: isApproved,
    role: 'teacher',
    appliedAt: existing.appliedAt || incoming.appliedAt || existing.createdAt || incoming.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Deduplicates and consolidates an array of tutor documents into a canonical list
 * where each approved Native Friend appears exactly once.
 */
export function consolidateTutorsList(list: any[]): CanonicalTutorRecord[] {
  if (!Array.isArray(list)) return [];
  const consolidated: CanonicalTutorRecord[] = [];
  for (const item of list) {
    if (!item) continue;
    const existingIndex = consolidated.findIndex((c) => areSameTutor(c, item));
    if (existingIndex >= 0) {
      consolidated[existingIndex] = mergeTutors(consolidated[existingIndex], item);
    } else {
      consolidated.push(mergeTutors({}, item));
    }
  }
  return consolidated;
}
