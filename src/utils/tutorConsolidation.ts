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
 * Validates whether an identity represents an authentic canonical Firebase Auth UID.
 * Rejects empty values, non-strings, emails, slugs with hyphens,
 * synthetic prefixes ('usr-*', 'st-*', 'teacher-*', 'lesson-*'), and system placeholders.
 */
export function toDeterministicCanonicalStudentUid(_email?: string | null): string {
  // Directiva obrigatória: Firebase Auth é a única autoridade de identidade.
  // Proibição absoluta: Nunca gerar UIDs a partir de e-mails ou hashes.
  return '';
}

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
    clean.includes(':') ||
    clean.includes('#')
  ) {
    return false;
  }
  const lower = clean.toLowerCase();
  if (
    lower.startsWith('usr') ||
    lower.startsWith('st-') ||
    lower.startsWith('st_') ||
    lower.startsWith('teacher-') ||
    lower.startsWith('lesson-') ||
    lower.startsWith('tutor-') ||
    lower === 'student-uid-123' ||
    lower === 'admin-master-uid' ||
    lower === 'user-default' ||
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
    lower === 'admin' ||
    lower === 'teacher' ||
    lower === 'tutor' ||
    lower === 'student' ||
    lower.includes('gmail') ||
    lower.includes('hotmail') ||
    lower.includes('yahoo') ||
    lower.includes('outlook')
  ) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(clean);
}

/**
 * Detects whether an identifier or name is a generic placeholder (e.g. 'tutor', 'teacher', 'admin', 'default').
 * Such values must NEVER be used as canonical teacher identity or valid public tutor slugs.
 */
export function isGenericTutorId(id?: string | null): boolean {
  if (!id || typeof id !== 'string') return true;
  const clean = id.trim().toLowerCase();
  return (
    clean === '' ||
    clean === 'tutor' ||
    clean === 'teacher' ||
    clean === 'admin' ||
    clean === 'student' ||
    clean === 'undefined' ||
    clean === 'null' ||
    clean === 'unknown' ||
    clean === 'default' ||
    clean === 'user_default' ||
    clean === 'userdefault' ||
    clean === 'anonymous_student' ||
    clean === 'native friend' ||
    clean === 'native_friend' ||
    clean === 'amigo nativo' ||
    clean === 'fake' ||
    clean === 'invalid'
  );
}

/**
 * Extracts a valid, non-generic public identifier from a tutor record.
 * Returns null if the candidate is generic, empty, or a canonical UID.
 */
function getValidPublicId(record: any): string | null {
  if (!record || typeof record !== 'object') return null;
  const candidates = [
    record.publicTutorId,
    // Only consider id if it is not an authentic canonical UID
    (!isValidCanonicalUid(record.id) ? record.id : null),
  ];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const clean = c.trim().toLowerCase();
      if (clean && clean.length >= 3 && !isGenericTutorId(clean)) {
        return clean;
      }
    }
  }
  return null;
}

/**
 * Robustly checks if two tutor records represent the exact same Native Friend.
 *
 * Rules:
 * 1. Canonical Firebase Auth UID is the highest-priority identity.
 *    - If both records have valid canonical UIDs, they are the same tutor iff UIDs match.
 *    - If both records have valid canonical UIDs and they differ, they are NEVER the same tutor.
 * 2. Real verified email addresses are checked:
 *    - If both records have emails and they differ, they are distinct tutors.
 *    - If both records share the same non-empty email, they match.
 * 3. Canonical UID cross-matching against legacy IDs or document keys.
 * 4. Public identifier matching is permitted ONLY when valid, non-generic, and unambiguous.
 * 5. Display names are NEVER used alone to equate two tutors (prevents false merges of similar names).
 */
export function areSameTutor(a: any, b: any): boolean {
  if (!a || !b) return false;

  // 1. Resolve canonical Firebase Auth UIDs (Priority 1)
  const aCanUid =
    (typeof a.authUid === 'string' && isValidCanonicalUid(a.authUid) ? a.authUid.trim() : null) ||
    (typeof a.uid === 'string' && isValidCanonicalUid(a.uid) ? a.uid.trim() : null) ||
    (typeof a.id === 'string' && isValidCanonicalUid(a.id) ? a.id.trim() : null);

  const bCanUid =
    (typeof b.authUid === 'string' && isValidCanonicalUid(b.authUid) ? b.authUid.trim() : null) ||
    (typeof b.uid === 'string' && isValidCanonicalUid(b.uid) ? b.uid.trim() : null) ||
    (typeof b.id === 'string' && isValidCanonicalUid(b.id) ? b.id.trim() : null);

  // If both records possess canonical Firebase UIDs:
  if (aCanUid && bCanUid) {
    return aCanUid === bCanUid;
  }

  // 2. Resolve Emails
  const aEmail = (typeof a.email === 'string' ? a.email : '').toLowerCase().trim();
  const bEmail = (typeof b.email === 'string' ? b.email : '').toLowerCase().trim();

  // If both records have valid emails and they conflict, they are definitively distinct persons
  if (aEmail && bEmail && aEmail !== bEmail) {
    return false;
  }

  // Mandatory security rule: Nunca associar registros somente por coincidência de e-mail.
  // Email equality alone is never sufficient to associate records without canonical UID or valid public ID link.

  // 3. Cross-match canonical UID with legacyId / legacyIds or raw ID
  if (aCanUid) {
    if (b.legacyId === aCanUid) return true;
    if (Array.isArray(b.legacyIds) && b.legacyIds.includes(aCanUid)) return true;
    if (typeof b.id === 'string' && b.id.trim() === aCanUid) return true;
  }
  if (bCanUid) {
    if (a.legacyId === bCanUid) return true;
    if (Array.isArray(a.legacyIds) && a.legacyIds.includes(bCanUid)) return true;
    if (typeof a.id === 'string' && a.id.trim() === bCanUid) return true;
  }

  // 4. Valid and unambiguous public identifier match (Priority 3)
  const aPublicId = getValidPublicId(a);
  const bPublicId = getValidPublicId(b);

  if (aPublicId && bPublicId && aPublicId === bPublicId) {
    return true;
  }

  // 5. Cross-match email-derived document ID (e.g. 'tutor-email' or 'usr-email')
  if (aEmail) {
    const cleanEmailId = `tutor-${aEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const usrEmailId = `usr-${aEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    if (bPublicId === cleanEmailId || bPublicId === usrEmailId) return true;
    if (b.legacyId === cleanEmailId || b.legacyId === usrEmailId) return true;
    if (Array.isArray(b.legacyIds) && (b.legacyIds.includes(cleanEmailId) || b.legacyIds.includes(usrEmailId))) return true;
  }
  if (bEmail) {
    const cleanEmailId = `tutor-${bEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const usrEmailId = `usr-${bEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    if (aPublicId === cleanEmailId || aPublicId === usrEmailId) return true;
    if (a.legacyId === cleanEmailId || a.legacyId === usrEmailId) return true;
    if (Array.isArray(a.legacyIds) && (a.legacyIds.includes(cleanEmailId) || a.legacyIds.includes(usrEmailId))) return true;
  }

  // 6. Cross-match legacyIds between records
  const aLegacyIds = Array.from(new Set([
    a.legacyId,
    ...(Array.isArray(a.legacyIds) ? a.legacyIds : []),
  ].filter((id) => typeof id === 'string' && id.trim().length >= 3 && !isGenericTutorId(id))));

  const bLegacyIds = Array.from(new Set([
    b.legacyId,
    ...(Array.isArray(b.legacyIds) ? b.legacyIds : []),
  ].filter((id) => typeof id === 'string' && id.trim().length >= 3 && !isGenericTutorId(id))));

  for (const aLeg of aLegacyIds) {
    if (bLegacyIds.includes(aLeg)) return true;
    if (bPublicId && bPublicId === aLeg.toLowerCase()) return true;
  }
  for (const bLeg of bLegacyIds) {
    if (aPublicId && aPublicId === bLeg.toLowerCase()) return true;
  }

  // Under Requirement 4, do NOT match purely by display name similarity
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

  const resolvedExistingUid =
    (typeof existing.authUid === 'string' && isValidCanonicalUid(existing.authUid) ? existing.authUid.trim() : null) ||
    (typeof existing.uid === 'string' && isValidCanonicalUid(existing.uid) ? existing.uid.trim() : null) ||
    (typeof existing.id === 'string' && isValidCanonicalUid(existing.id) ? existing.id.trim() : null);

  const resolvedIncomingUid =
    (typeof incoming.authUid === 'string' && isValidCanonicalUid(incoming.authUid) ? incoming.authUid.trim() : null) ||
    (typeof incoming.uid === 'string' && isValidCanonicalUid(incoming.uid) ? incoming.uid.trim() : null) ||
    (typeof incoming.id === 'string' && isValidCanonicalUid(incoming.id) ? incoming.id.trim() : null);

  const finalCanonicalUid = resolvedExistingUid || resolvedIncomingUid || null;

  const resolvedCanonicalUid = (finalCanonicalUid && isValidCanonicalUid(finalCanonicalUid))
    ? finalCanonicalUid
    : (existing.uid && !isGenericTutorId(existing.uid) ? existing.uid : null) ||
      (existing.authUid && !isGenericTutorId(existing.authUid) ? existing.authUid : null) ||
      (incoming.uid && !isGenericTutorId(incoming.uid) ? incoming.uid : null) ||
      (incoming.authUid && !isGenericTutorId(incoming.authUid) ? incoming.authUid : null) ||
      undefined;

  // Prioritize persistent public tutor ID over synthetic email ids
  const isPrettyPublicId = (id?: string) =>
    Boolean(
      id &&
      typeof id === 'string' &&
      !isGenericTutorId(id) &&
      !id.includes('@') &&
      !id.startsWith('usr-') &&
      !id.startsWith('tutor-') &&
      id.length < 50 &&
      !isValidCanonicalUid(id)
    );

  const cleanPublicCandidate = (id?: string | null): string | null => {
    if (!id || typeof id !== 'string') return null;
    const trimmed = id.trim();
    if (isGenericTutorId(trimmed)) return null;
    return trimmed;
  };

  const generateSlugFromName = (name?: string): string => {
    const norm = normalizeTutorName(name);
    if (!norm || isGenericTutorId(norm)) return '';
    const slug = norm.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug && !isGenericTutorId(slug) ? slug : '';
  };

  const nameSlug = generateSlugFromName(incoming.name) || generateSlugFromName(existing.name);
  const emailSlug = email ? `tutor-${email.replace(/[^a-zA-Z0-9]/g, '-')}` : '';

  const publicTutorId =
    cleanPublicCandidate(isPrettyPublicId(existing.publicTutorId) ? existing.publicTutorId : null) ||
    cleanPublicCandidate(isPrettyPublicId(incoming.publicTutorId) ? incoming.publicTutorId : null) ||
    cleanPublicCandidate(isPrettyPublicId(existing.id) ? existing.id : null) ||
    cleanPublicCandidate(isPrettyPublicId(incoming.id) ? incoming.id : null) ||
    cleanPublicCandidate(existing.publicTutorId) ||
    cleanPublicCandidate(incoming.publicTutorId) ||
    (nameSlug ? nameSlug : null) ||
    (emailSlug ? emailSlug : null) ||
    (resolvedCanonicalUid && isValidCanonicalUid(resolvedCanonicalUid) ? resolvedCanonicalUid : undefined);

  const legacyIds = Array.from(new Set([
    ...(Array.isArray(existing.legacyIds) ? existing.legacyIds : [existing.legacyId || existing.id]),
    ...(Array.isArray(incoming.legacyIds) ? incoming.legacyIds : [incoming.legacyId || incoming.id]),
  ].filter(Boolean))).filter((id) => id !== publicTutorId && id !== resolvedCanonicalUid);

  const isGenericName = (n?: string) =>
    !n || n.toLowerCase() === 'native friend';

  // Compare timestamps if available to assess whether incoming is newer
  const existingTime = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
  const incomingTime = incoming?.updatedAt ? new Date(incoming.updatedAt).getTime() : 0;
  const incomingIsNewer = incomingTime >= existingTime || !existingTime;

  // Name resolution: Incoming non-generic non-empty name takes precedence
  let finalName = '';
  if (incoming.name !== undefined && typeof incoming.name === 'string' && incoming.name.trim() !== '') {
    const cleanIncName = incoming.name.trim();
    if (!isGenericName(cleanIncName) || !existing.name || isGenericName(existing.name)) {
      finalName = cleanIncName;
    } else {
      finalName = existing.name.trim();
    }
  } else if (existing.name !== undefined && typeof existing.name === 'string' && existing.name.trim() !== '') {
    finalName = existing.name.trim();
  } else {
    finalName = 'Native Friend';
  }

  // Headline resolution: Incoming updated headline takes precedence; supports intentional update
  let finalHeadline = '';
  if (incoming.headline !== undefined && typeof incoming.headline === 'string') {
    const cleanIncHeadline = incoming.headline.trim();
    if (cleanIncHeadline !== '') {
      finalHeadline = cleanIncHeadline;
    } else if (incomingIsNewer) {
      finalHeadline = '';
    } else {
      finalHeadline = existing.headline || 'English Conversational Native Friend';
    }
  } else if (existing.headline !== undefined && typeof existing.headline === 'string') {
    finalHeadline = existing.headline;
  } else {
    finalHeadline = 'English Conversational Native Friend';
  }

  // Biography resolution: Incoming updated bio takes precedence; supports intentional update
  let finalBio = '';
  if (incoming.bio !== undefined && typeof incoming.bio === 'string') {
    const cleanIncBio = incoming.bio.trim();
    if (cleanIncBio !== '') {
      finalBio = cleanIncBio;
    } else if (incomingIsNewer) {
      finalBio = '';
    } else {
      finalBio = existing.bio || 'Native English speaker ready to help you speak with natural fluency.';
    }
  } else if (existing.bio !== undefined && typeof existing.bio === 'string') {
    finalBio = existing.bio;
  } else {
    finalBio = 'Native English speaker ready to help you speak with natural fluency.';
  }

  // Avatar / photoUrl resolution: Incoming updated avatar takes precedence; preserves if omitted
  let finalAvatar = '';
  if (incoming.avatar !== undefined || incoming.photoUrl !== undefined) {
    const incAv = (incoming.avatar !== undefined ? incoming.avatar : incoming.photoUrl) || '';
    if (incAv !== '' || incomingIsNewer) {
      finalAvatar = incAv;
    } else {
      finalAvatar = existing.avatar || existing.photoUrl || '';
    }
  } else {
    finalAvatar = existing.avatar || existing.photoUrl || '';
  }

  // Accent resolution: Incoming updated accent takes precedence
  const finalAccent = (incoming.accent !== undefined && incoming.accent.trim() !== '')
    ? incoming.accent.trim()
    : (existing.accent || incoming.accent || 'North American');

  // Country resolution
  const finalCountry = (incoming.country !== undefined && incoming.country.trim() !== '')
    ? incoming.country.trim()
    : (existing.country || incoming.country || 'Global');

  const finalCountryCode = (incoming.countryCode !== undefined && incoming.countryCode.trim() !== '')
    ? incoming.countryCode.trim()
    : (existing.countryCode || incoming.countryCode || '');

  const finalFlag = (incoming.flag !== undefined && incoming.flag.trim() !== '')
    ? incoming.flag.trim()
    : (existing.flag || incoming.flag || '🇺🇸');

  // Timezone resolution
  const finalTimezone = (incoming.timezone !== undefined && incoming.timezone.trim() !== '')
    ? incoming.timezone.trim()
    : (existing.timezone || incoming.timezone || 'America/Toronto');

  // Specialties resolution
  let finalSpecialties: string[] = [];
  if (Array.isArray(incoming.specialties) && incoming.specialties.length > 0) {
    finalSpecialties = incoming.specialties;
  } else if (Array.isArray(incoming.specialties) && incoming.specialties.length === 0 && incomingIsNewer) {
    finalSpecialties = [];
  } else if (Array.isArray(existing.specialties) && existing.specialties.length > 0) {
    finalSpecialties = existing.specialties;
  } else {
    finalSpecialties = ['Conversação', 'Pronúncia', 'Fluência'];
  }

  // Pricing resolution
  let finalPriceUsd = 20;
  if (typeof incoming.pricePerSessionUsd === 'number' && !isNaN(incoming.pricePerSessionUsd) && incoming.pricePerSessionUsd > 0) {
    finalPriceUsd = incoming.pricePerSessionUsd;
  } else if (incoming.pricePerSessionUsd !== undefined && Number(incoming.pricePerSessionUsd) > 0) {
    finalPriceUsd = Number(incoming.pricePerSessionUsd);
  } else if (typeof existing.pricePerSessionUsd === 'number' && !isNaN(existing.pricePerSessionUsd) && existing.pricePerSessionUsd > 0) {
    finalPriceUsd = existing.pricePerSessionUsd;
  } else if (existing.pricePerSessionUsd !== undefined && Number(existing.pricePerSessionUsd) > 0) {
    finalPriceUsd = Number(existing.pricePerSessionUsd);
  }

  let finalPriceBrl = Math.round(finalPriceUsd * 5.5);
  if (typeof incoming.pricePerSessionBrl === 'number' && !isNaN(incoming.pricePerSessionBrl) && incoming.pricePerSessionBrl > 0) {
    finalPriceBrl = incoming.pricePerSessionBrl;
  } else if (incoming.pricePerSessionBrl !== undefined && Number(incoming.pricePerSessionBrl) > 0) {
    finalPriceBrl = Number(incoming.pricePerSessionBrl);
  } else if (typeof existing.pricePerSessionBrl === 'number' && !isNaN(existing.pricePerSessionBrl) && existing.pricePerSessionBrl > 0) {
    finalPriceBrl = existing.pricePerSessionBrl;
  } else if (existing.pricePerSessionBrl !== undefined && Number(existing.pricePerSessionBrl) > 0) {
    finalPriceBrl = Number(existing.pricePerSessionBrl);
  }

  // Video presentation links: Support intentional update or clearing
  let finalVideoLink = '';
  if (
    incoming.videoIntroUrl !== undefined ||
    incoming.youtubeUrl !== undefined ||
    incoming.videoUrl !== undefined ||
    incoming.introVideoUrl !== undefined
  ) {
    finalVideoLink = (incoming.videoIntroUrl ?? incoming.youtubeUrl ?? incoming.videoUrl ?? incoming.introVideoUrl ?? '').trim();
  } else {
    finalVideoLink = (existing.videoIntroUrl ?? existing.youtubeUrl ?? existing.videoUrl ?? existing.introVideoUrl ?? '').trim();
  }

  // Meet link / URL
  const finalMeetUrl = (incoming.meetUrl || incoming.meetLink || existing.meetUrl || existing.meetLink || '').trim();

  // Availability & schedule: Preserve existing if omitted in incoming
  const finalAvailableDays = (Array.isArray(incoming.availableDays) && incoming.availableDays.length > 0)
    ? incoming.availableDays
    : (Array.isArray(existing.availableDays) && existing.availableDays.length > 0 ? existing.availableDays : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);

  const finalAvailableHours = (Array.isArray(incoming.availableHours) && incoming.availableHours.length > 0)
    ? incoming.availableHours
    : (Array.isArray(existing.availableHours) && existing.availableHours.length > 0 ? existing.availableHours : ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00']);

  const finalAvailability = (incoming.availability && Object.keys(incoming.availability).length > 0)
    ? incoming.availability
    : (existing.availability && Object.keys(existing.availability).length > 0 ? existing.availability : (existing.availableHoursByDay || incoming.availableHoursByDay || {}));

  const finalAvailableHoursByDay = (incoming.availableHoursByDay && Object.keys(incoming.availableHoursByDay).length > 0)
    ? incoming.availableHoursByDay
    : (existing.availableHoursByDay && Object.keys(existing.availableHoursByDay).length > 0 ? existing.availableHoursByDay : finalAvailability);

  const candidatePublicId =
    publicTutorId ||
    (typeof incoming.publicTutorId === 'string' && !isGenericTutorId(incoming.publicTutorId) ? incoming.publicTutorId.trim() : undefined) ||
    (typeof existing.publicTutorId === 'string' && !isGenericTutorId(existing.publicTutorId) ? existing.publicTutorId.trim() : undefined) ||
    (typeof incoming.id === 'string' && !isGenericTutorId(incoming.id) && !isValidCanonicalUid(incoming.id) ? incoming.id.trim() : undefined) ||
    (typeof existing.id === 'string' && !isGenericTutorId(existing.id) && !isValidCanonicalUid(existing.id) ? existing.id.trim() : undefined) ||
    (nameSlug && !isGenericTutorId(nameSlug) ? nameSlug : undefined) ||
    (emailSlug && !isGenericTutorId(emailSlug) ? emailSlug : undefined) ||
    resolvedCanonicalUid ||
    '';

  const safePublicId = !isGenericTutorId(candidatePublicId)
    ? candidatePublicId
    : (nameSlug || (emailSlug && !isGenericTutorId(emailSlug) ? emailSlug : '') || resolvedCanonicalUid || '');

  const resolvedId = resolvedCanonicalUid || safePublicId || 'native-friend';

  return {
    ...existing,
    ...incoming,
    id: resolvedId,
    publicTutorId: safePublicId || resolvedId,
    authUid: resolvedCanonicalUid || existing.authUid || undefined,
    uid: resolvedCanonicalUid || existing.uid || undefined,
    legacyId: legacyIds[0] || existing.legacyId || incoming.legacyId,
    legacyIds,
    email: email || undefined,
    name: finalName,
    headline: finalHeadline,
    bio: finalBio,
    avatar: finalAvatar,
    photoUrl: finalAvatar,
    country: finalCountry,
    countryCode: finalCountryCode,
    flag: finalFlag,
    accent: finalAccent,
    meetLink: finalMeetUrl,
    meetUrl: finalMeetUrl,
    timezone: finalTimezone,
    specialties: finalSpecialties,
    availableDays: finalAvailableDays,
    availableHours: finalAvailableHours,
    availableHoursByDay: finalAvailableHoursByDay,
    availability: finalAvailability,
    pricePerSessionUsd: finalPriceUsd,
    pricePerSessionBrl: finalPriceBrl,
    videoIntroUrl: finalVideoLink,
    youtubeUrl: finalVideoLink,
    videoUrl: finalVideoLink,
    introVideoUrl: finalVideoLink,
    youtubeEmbedId: incoming.youtubeEmbedId || existing.youtubeEmbedId || '',
    rating: typeof existing.rating === 'number' ? existing.rating : (typeof incoming.rating === 'number' ? incoming.rating : 5.0),
    reviewsCount: typeof existing.reviewsCount === 'number' ? existing.reviewsCount : (typeof incoming.reviewsCount === 'number' ? incoming.reviewsCount : 0),
    activeStudents: typeof existing.activeStudents === 'number' ? existing.activeStudents : (typeof incoming.activeStudents === 'number' ? incoming.activeStudents : 0),
    lessonsTaught: typeof existing.lessonsTaught === 'number' ? existing.lessonsTaught : (typeof incoming.lessonsTaught === 'number' ? incoming.lessonsTaught : 12),
    isSuperTutor: Boolean(existing.isSuperTutor || incoming.isSuperTutor),
    // Strictly preserve protected records and assignments
    assignedStudents: existing.assignedStudents || incoming.assignedStudents || [],
    trialBookings: existing.trialBookings || incoming.trialBookings || [],
    existingLessons: existing.existingLessons || incoming.existingLessons || [],
    approvalStatus,
    isApproved,
    status: approvalStatus,
    approved: isApproved,
    role: 'teacher',
    appliedAt: existing.appliedAt || incoming.appliedAt || existing.createdAt || incoming.createdAt || new Date().toISOString(),
    updatedAt: incoming.updatedAt || existing.updatedAt || undefined,
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
      const existing = consolidated[existingIndex];
      const exTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const itemTime = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
      // If neither has explicit updatedAt, or item timestamp >= existing timestamp, item takes precedence as later/incoming
      if (!existing.updatedAt || itemTime >= exTime) {
        consolidated[existingIndex] = mergeTutors(existing, item);
      } else {
        consolidated[existingIndex] = mergeTutors(item, existing);
      }
    } else {
      consolidated.push(mergeTutors({}, item));
    }
  }
  return consolidated;
}
