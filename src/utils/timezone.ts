import { DayOfWeek } from '../types';

export const DEFAULT_STUDENT_TIMEZONE = 'America/Sao_Paulo';
export const DEFAULT_TEACHER_TIMEZONE = 'America/Toronto';

export function sanitizeTimeZone(tz?: string): string {
  if (!tz) return DEFAULT_STUDENT_TIMEZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_STUDENT_TIMEZONE;
  }
}

/**
 * Accurately calculates the student's current day of the week based on their local timezone
 * (defaults to America/Sao_Paulo) to prevent premature or incorrect Rest Day display.
 */
export function getStudentCurrentDayOfWeek(
  timeZone: string = DEFAULT_STUDENT_TIMEZONE,
  baseDate: Date = new Date()
): DayOfWeek {
  const tz = sanitizeTimeZone(timeZone);
  try {
    const dayStr = baseDate.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' }).toLowerCase();
    const map: Record<string, DayOfWeek> = {
      monday: 'monday',
      tuesday: 'tuesday',
      wednesday: 'wednesday',
      thursday: 'thursday',
      friday: 'friday',
      saturday: 'saturday',
      sunday: 'sunday',
    };
    return map[dayStr] || 'monday';
  } catch {
    const dayNum = baseDate.getDay();
    const mapNum: Record<number, DayOfWeek> = {
      0: 'sunday',
      1: 'monday',
      2: 'tuesday',
      3: 'wednesday',
      4: 'thursday',
      5: 'friday',
      6: 'saturday',
    };
    return mapNum[dayNum] || 'monday';
  }
}

export function formatDateInTimeZone(
  isoDateString: string,
  timeZone: string = DEFAULT_STUDENT_TIMEZONE,
  lang: 'pt' | 'en' = 'pt'
): string {
  try {
    const d = new Date(isoDateString);
    return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'pt-BR', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return new Date(isoDateString).toLocaleDateString(lang === 'en' ? 'en-US' : 'pt-BR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }
}

export function formatTimeInTimeZone(
  isoDateString: string,
  timeZone: string = DEFAULT_STUDENT_TIMEZONE
): string {
  try {
    const d = new Date(isoDateString);
    return d.toLocaleTimeString('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return new Date(isoDateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }
}

export function formatTimeSlot12h(timeStr: string): string {
  if (!timeStr) return '';
  const trimmed = timeStr.trim();
  // If already in 12h format (e.g., '12:00 AM', '01:30 PM')
  if (/^(0?[1-9]|1[0-2]):[0-5][0-9]\s*(AM|PM)$/i.test(trimmed)) {
    const [t, ampm] = trimmed.split(/\s+/);
    const [h, m] = t.split(':');
    return `${h.padStart(2, '0')}:${m} ${ampm.toUpperCase()}`;
  }
  const parts = trimmed.split(':');
  if (parts.length < 2) return trimmed;
  const hour = parseInt(parts[0], 10);
  const min = parts[1].slice(0, 2);
  if (isNaN(hour)) return trimmed;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${String(hour12).padStart(2, '0')}:${min} ${ampm}`;
}

/**
 * Parses any 12h or 24h time string to standard 24h 'HH:mm' format
 */
export function parseTimeSlotTo24h(timeStr: string): string {
  if (!timeStr) return '';
  const trimmed = timeStr.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return trimmed;
  let h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = match[3].toUpperCase();
  if (ampm === 'AM') {
    if (h === 12) h = 0;
  } else {
    if (h < 12) h += 12;
  }
  return `${String(h).padStart(2, '0')}:${m}`;
}

export function getDayKeyInTimeZone(
  isoDateString: string,
  timeZone: string = DEFAULT_STUDENT_TIMEZONE
): 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' {
  try {
    const d = new Date(isoDateString);
    const dayStr = d.toLocaleDateString('en-US', { timeZone, weekday: 'short' }).toLowerCase();
    if (dayStr.startsWith('mon')) return 'mon';
    if (dayStr.startsWith('tue')) return 'tue';
    if (dayStr.startsWith('wed')) return 'wed';
    if (dayStr.startsWith('thu')) return 'thu';
    if (dayStr.startsWith('fri')) return 'fri';
    if (dayStr.startsWith('sat')) return 'sat';
    if (dayStr.startsWith('sun')) return 'sun';
    return 'mon';
  } catch {
    const day = new Date(isoDateString).getDay();
    const map: Record<number, 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'> = {
      0: 'sun',
      1: 'mon',
      2: 'tue',
      3: 'wed',
      4: 'thu',
      5: 'fri',
      6: 'sat',
    };
    return map[day] || 'mon';
  }
}

export function getDefaultTimezoneForCountry(country?: string, accent?: string): string {
  const c = (country || '').toLowerCase().trim();
  const a = (accent || '').toLowerCase().trim();

  if (c.includes('canada') || a.includes('toronto') || a.includes('canada') || a.includes('canadian')) {
    return 'America/Toronto';
  }
  if (c.includes('united states') || c.includes('usa') || c.includes('us') || a.includes('american') || a.includes('new york')) {
    return 'America/New_York';
  }
  if (c.includes('united kingdom') || c.includes('uk') || c.includes('ireland') || a.includes('british') || a.includes('irish')) {
    return 'Europe/London';
  }
  if (c.includes('south africa') || a.includes('south african')) {
    return 'Africa/Johannesburg';
  }
  if (c.includes('australia') || a.includes('australian') || a.includes('sydney')) {
    return 'Australia/Sydney';
  }
  if (c.includes('new zealand') || a.includes('kiwi')) {
    return 'Pacific/Auckland';
  }
  if (c.includes('brazil') || c.includes('brasil')) {
    return 'America/Sao_Paulo';
  }
  return DEFAULT_TEACHER_TIMEZONE;
}

export function getTimezoneDisplayLabel(
  timeZone: string = DEFAULT_STUDENT_TIMEZONE,
  lang: 'pt' | 'en' = 'pt'
): string {
  if (timeZone.includes('Toronto') || timeZone.includes('New_York') || timeZone.includes('Eastern')) {
    return lang === 'en' ? 'Eastern Time (Toronto/NY)' : 'Horário do Leste (Toronto/NY)';
  }
  if (timeZone.includes('Sao_Paulo') || timeZone.includes('Brazil')) {
    return lang === 'en' ? 'Brasília Time (GMT-3)' : 'Horário de Brasília (GMT-3)';
  }
  if (timeZone.includes('Chicago')) return 'Central Time (Chicago)';
  if (timeZone.includes('Los_Angeles')) return 'Pacific Time (LA)';
  if (timeZone.includes('London') || timeZone.includes('Dublin')) return 'London (GMT)';
  if (timeZone.includes('Lisbon')) return 'Lisboa / Portugal';
  if (timeZone.includes('Johannesburg')) return 'South Africa (SAST)';
  if (timeZone.includes('Sydney') || timeZone.includes('Melbourne')) return 'Sydney (AEST)';
  if (timeZone.includes('Auckland')) return 'New Zealand (NZST)';
  return timeZone.replace('_', ' ');
}

export function getShortTzBadge(timeZone: string): string {
  if (timeZone.includes('Toronto') || timeZone.includes('New_York') || timeZone.includes('Eastern')) return 'ET (GMT-4)';
  if (timeZone.includes('Sao_Paulo') || timeZone.includes('Belem') || timeZone.includes('Brazil')) return 'BRT (GMT-3)';
  if (timeZone.includes('London')) return 'GMT';
  if (timeZone.includes('Lisbon')) return 'WET';
  if (timeZone.includes('Los_Angeles')) return 'PT (GMT-7)';
  if (timeZone.includes('Chicago')) return 'CT (GMT-5)';
  if (timeZone.includes('Johannesburg')) return 'SAST (GMT+2)';
  if (timeZone.includes('Sydney')) return 'AEST (GMT+10)';
  if (timeZone.includes('Auckland')) return 'NZST (GMT+12)';
  return 'GMT';
}


export const TIMEZONE_OPTIONS = [
  { value: 'America/Toronto', label: 'Toronto / New York (ET)', offset: 'GMT-4' },
  { value: 'America/New_York', label: 'New York / Eastern Time (ET)', offset: 'GMT-4' },
  { value: 'America/Chicago', label: 'Chicago (CT)', offset: 'GMT-5' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PT)', offset: 'GMT-7' },
  { value: 'America/Sao_Paulo', label: 'Brasília (BRT)', offset: 'GMT-3' },
  { value: 'Europe/London', label: 'London / Dublin (GMT)', offset: 'GMT+0' },
  { value: 'Europe/Lisbon', label: 'Lisbon (WET)', offset: 'GMT+0' },
  { value: 'Europe/Madrid', label: 'Madrid / Paris (CET)', offset: 'GMT+1' },
  { value: 'Africa/Johannesburg', label: 'South Africa (SAST)', offset: 'GMT+2' },
  { value: 'Australia/Sydney', label: 'Sydney / Melbourne (AEST)', offset: 'GMT+10' },
  { value: 'Pacific/Auckland', label: 'Auckland / NZ (NZST)', offset: 'GMT+12' },
];

export function generate30MinTimeSlots(startHour: string = '00:00', endHour: string = '24:00'): string[] {
  const slots: string[] = [];
  const [sH, sM] = startHour.split(':').map(Number);
  const [eH, eM] = endHour.split(':').map(Number);

  let currentMin = (isNaN(sH) ? 0 : sH) * 60 + (isNaN(sM) ? 0 : sM);
  let endMin = (isNaN(eH) ? 24 : eH) * 60 + (isNaN(eM) ? 0 : eM);

  // If caller specified 23:30 expecting to include the final 30-min slot of the day, cap at 24:00 (1440 mins)
  if (eH === 23 && eM === 30) {
    endMin = 24 * 60;
  }

  while (currentMin < endMin) {
    const h = Math.floor(currentMin / 60);
    const m = currentMin % 60;
    const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    slots.push(formatted);
    currentMin += 30;
  }

  return slots;
}

// Full 24-hour fixed 30-minute availability slots from 00:00 (12:00 AM) to 23:30 (11:30 PM) - 48 total slots
export const FIXED_30MIN_AVAILABILITY_SLOTS: string[] = generate30MinTimeSlots('00:00', '24:00');

// Default popular teacher daytime availability hours (08:00 to 18:00)
export const DEFAULT_TEACHER_AVAILABILITY_HOURS: string[] = generate30MinTimeSlots('08:00', '18:00');

/**
 * Constructs a precise UTC ISO 8601 string for a given date (YYYY-MM-DD) and time (HH:mm)
 * within a specific IANA time zone (e.g., 'America/Sao_Paulo'), independent of browser local timezone.
 */
export function buildIsoInTimeZone(
  dateStr: string,
  timeStr: string,
  timeZone: string = DEFAULT_STUDENT_TIMEZONE,
  addMinutes: number = 0
): string {
  if (!dateStr || !timeStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);

  if (isNaN(y) || isNaN(m) || isNaN(d) || isNaN(h) || isNaN(min)) return '';

  const tz = sanitizeTimeZone(timeZone);
  // Initial UTC guess
  let utcGuess = new Date(Date.UTC(y, m - 1, d, h, min, 0, 0));

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    // Iteratively adjust offset to match target wall clock time in specified timezone
    for (let i = 0; i < 3; i++) {
      const parts = formatter.formatToParts(utcGuess);
      const p: Record<string, string> = {};
      parts.forEach((part) => {
        p[part.type] = part.value;
      });

      const localH = (parseInt(p.hour || '0', 10)) % 24;
      const localM = parseInt(p.minute || '0', 10);
      const localD = parseInt(p.day || '0', 10);

      const diffMs = ((d - localD) * 24 * 60 + (h - localH) * 60 + (min - localM)) * 60 * 1000;
      if (diffMs === 0) break;
      utcGuess = new Date(utcGuess.getTime() + diffMs);
    }
  } catch {
    // Fallback in case of an invalid timezone string
    utcGuess = new Date(Date.UTC(y, m - 1, d, h, min, 0, 0));
  }

  if (addMinutes !== 0) {
    utcGuess = new Date(utcGuess.getTime() + addMinutes * 60 * 1000);
  }

  return utcGuess.toISOString();
}

/**
 * Checks if two time intervals overlap: [startA, endA) and [startB, endB)
 */
export function checkTimeRangesOverlap(
  startA: string | number | Date,
  endA: string | number | Date,
  startB: string | number | Date,
  endB: string | number | Date
): boolean {
  const sA = startA instanceof Date ? startA.getTime() : new Date(startA).getTime();
  const eA = endA instanceof Date ? endA.getTime() : new Date(endA).getTime();
  const sB = startB instanceof Date ? startB.getTime() : new Date(startB).getTime();
  const eB = endB instanceof Date ? endB.getTime() : new Date(endB).getTime();

  if (isNaN(sA) || isNaN(eA) || isNaN(sB) || isNaN(eB)) return false;
  return sA < eB && eA > sB;
}

export function isLessonCancelled(l: any): boolean {
  if (!l) return false;
  if (l.status === 'cancelled' || l.status === 'canceled') return true;
  if (Boolean(l.cancelledAt)) return true;
  return false;
}

/**
 * Finds if there is an existing scheduled lesson conflicting with the proposed time range for a teacher or student.
 * Individualized by both email and UID.
 */
export function findTeacherLessonConflict<T extends {
  id?: string;
  teacherEmail?: string;
  tutorEmail?: string;
  teacherUid?: string;
  tutorUid?: string;
  studentEmail?: string;
  studentUid?: string;
  status?: string;
  cancelledAt?: string;
  startDateTime?: string;
  endDateTime?: string;
  [key: string]: any;
}>(
  teacherEmail: string,
  proposedStartIso: string,
  proposedEndIso: string,
  lessons: T[],
  excludeLessonId?: string,
  teacherUid?: string,
  studentEmail?: string,
  studentUid?: string
): T | null {
  if ((!teacherEmail && !teacherUid) || !proposedStartIso || !proposedEndIso || !Array.isArray(lessons)) {
    return null;
  }

  const cleanTeacher = (teacherEmail || '').toLowerCase().trim();
  const cleanTeacherUid = (teacherUid || '').trim();
  const cleanStudent = (studentEmail || '').toLowerCase().trim();
  const cleanStudentUid = (studentUid || '').trim();

  const pStart = new Date(proposedStartIso).getTime();
  const pEnd = new Date(proposedEndIso).getTime();

  if (isNaN(pStart) || isNaN(pEnd) || pStart >= pEnd) return null;

  for (const l of lessons) {
    if (excludeLessonId && l.id === excludeLessonId) continue;
    // Cancelled lessons or lessons not currently in active 'scheduled' status do not occupy slots
    if (isLessonCancelled(l)) continue;
    if (l.status && l.status !== 'scheduled') continue;

    const lTeacher = (l.teacherEmail || l.tutorEmail || '').toLowerCase().trim();
    const lTeacherUid = (l.teacherUid || l.tutorUid || '').trim();
    const lStudent = (l.studentEmail || '').toLowerCase().trim();
    const lStudentUid = (l.studentUid || '').trim();

    // Check if the lesson belongs to the same teacher
    const isTeacherMatch = (cleanTeacherUid && lTeacherUid && cleanTeacherUid === lTeacherUid) ||
                           (cleanTeacher && lTeacher && cleanTeacher === lTeacher);

    // Or if checking student, if the lesson belongs to the same student
    const isStudentMatch = (cleanStudentUid && lStudentUid && cleanStudentUid === lStudentUid) ||
                           (cleanStudent && lStudent && cleanStudent === lStudent);

    if (!isTeacherMatch && !isStudentMatch) continue;

    if (!l.startDateTime || !l.endDateTime) continue;
    const lStart = new Date(l.startDateTime).getTime();
    const lEnd = new Date(l.endDateTime).getTime();

    if (isNaN(lStart) || isNaN(lEnd)) continue;

    // Check overlap: lStart < pEnd && lEnd > pStart
    if (lStart < pEnd && lEnd > pStart) {
      return l;
    }
  }

  return null;
}


