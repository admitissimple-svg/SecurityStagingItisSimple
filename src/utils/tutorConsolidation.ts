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
  const aName = normalizeTutorName(a.name);
  const bName = normalizeTutorName(b.name);
  if (aName && bName && aName === bName && aName !== 'native friend' && aName !== 'aluno' && aName !== 'teacher') {
    // Only match if emails do not explicitly conflict
    if (!aEmail || !bEmail || aEmail === bEmail) {
      return true;
    }
  }

  return false;
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
  const authUid =
    existing.authUid ||
    incoming.authUid ||
    (existing.uid && !existing.uid.startsWith('usr-') && !existing.uid.startsWith('tutor-') ? existing.uid : '') ||
    (incoming.uid && !incoming.uid.startsWith('usr-') && !incoming.uid.startsWith('tutor-') ? incoming.uid : '') ||
    undefined;

  // Prioritize persistent public tutor ID (e.g. 'skull-bee' or 'queen-bee' over synthetic email ids)
  const isPrettyPublicId = (id?: string) =>
    Boolean(id && !id.includes('@') && !id.startsWith('usr-') && !id.startsWith('tutor-') && id.length < 30);

  const publicTutorId =
    (isPrettyPublicId(existing.publicTutorId) ? existing.publicTutorId : null) ||
    (isPrettyPublicId(incoming.publicTutorId) ? incoming.publicTutorId : null) ||
    (isPrettyPublicId(existing.id) ? existing.id : null) ||
    (isPrettyPublicId(incoming.id) ? incoming.id : null) ||
    existing.publicTutorId ||
    incoming.publicTutorId ||
    existing.id ||
    incoming.id ||
    (email ? `tutor-${email.replace(/[^a-zA-Z0-9]/g, '-')}` : 'tutor');

  const legacyIds = Array.from(new Set([
    ...(Array.isArray(existing.legacyIds) ? existing.legacyIds : [existing.legacyId || existing.id]),
    ...(Array.isArray(incoming.legacyIds) ? incoming.legacyIds : [incoming.legacyId || incoming.id]),
  ].filter(Boolean))).filter((id) => id !== publicTutorId && id !== authUid);

  return {
    ...incoming,
    ...existing,
    id: publicTutorId,
    publicTutorId,
    authUid: authUid || existing.authUid || incoming.authUid,
    uid: authUid || existing.uid || incoming.uid || publicTutorId,
    legacyId: legacyIds[0] || existing.legacyId || incoming.legacyId,
    legacyIds,
    email: email || undefined,
    name: existing.name || incoming.name || 'Native Friend',
    headline: existing.headline || incoming.headline || 'English Conversational Native Friend',
    bio: existing.bio || incoming.bio || 'Native English speaker ready to help you speak with natural fluency.',
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
