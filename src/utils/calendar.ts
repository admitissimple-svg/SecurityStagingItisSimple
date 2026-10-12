import { LiveLesson, TeacherMeetSettings, DayOfWeek } from '../types';
import { getDayKeyInTimeZone, isLessonCancelled } from './timezone';

export interface TeacherTimeSlot {
  start: string; // ISO string
  end: string;   // ISO string
  formattedTime: string; // "08:00" or "08:30"
  isAvailable: boolean;
  conflictReason?: string;
}

export function deduplicateLessons(lessons: LiveLesson[]): LiveLesson[] {
  if (!Array.isArray(lessons)) return [];
  const seen = new Set<string>();
  const result: LiveLesson[] = [];

  for (const l of lessons) {
    if (!l || !l.id || !l.startDateTime) continue;
    // Key by ID or by teacher+student+startDateTime
    const keyById = `id_${l.id}`;
    const keyBySlot = `slot_${(l.teacherEmail || '').toLowerCase()}_${(l.studentEmail || '').toLowerCase()}_${new Date(l.startDateTime).getTime()}`;

    if (!seen.has(keyById) && !seen.has(keyBySlot)) {
      seen.add(keyById);
      seen.add(keyBySlot);
      result.push(l);
    }
  }

  return result;
}

export async function fetchCalendarEvents(
  token: string,
  timeMin: string,
  timeMax: string
): Promise<any[]> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(
        timeMin
      )}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (res.ok) {
      const data = await res.json();
      return data.items || [];
    }
  } catch (err) {
    console.warn('Could not fetch Google Calendar events:', err);
  }
  return [];
}

export async function createLiveLessonCalendarEvent(
  token: string,
  details: {
    summary: string;
    description: string;
    startDateTime: string;
    endDateTime: string;
    attendeeEmail: string;
    teacherEmail: string;
    customMeetLink?: string;
  }
): Promise<{ id: string; htmlLink?: string; meetLink?: string }> {
  try {
    const eventBody = {
      summary: details.summary,
      description: details.description,
      start: { dateTime: details.startDateTime },
      end: { dateTime: details.endDateTime },
      attendees: [
        { email: details.attendeeEmail },
        { email: details.teacherEmail },
      ],
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      }
    );

    if (res.ok) {
      const data = await res.json();
      const meetLink =
        data.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri ||
        details.customMeetLink;
      return {
        id: data.id,
        htmlLink: data.htmlLink,
        meetLink,
      };
    }
  } catch (e) {
    console.warn('Calendar API call failed, generating simulated event:', e);
  }

  return {
    id: `event-${Date.now()}`,
    htmlLink: details.customMeetLink,
    meetLink: details.customMeetLink || 'https://meet.google.com/new',
  };
}

export async function deleteCalendarEvent(token: string, eventId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export function generateTeacherAvailableSlots(
  dateString: string,
  teacherSettings: TeacherMeetSettings,
  busyEvents: any[] = [],
  durationMinutes: 25 | 50 = 25,
  existingLessons: LiveLesson[] = [],
  excludeLessonId?: string,
  studentEmail?: string,
  viewerTimeZone: string = 'America/Sao_Paulo'
): TeacherTimeSlot[] {
  const slots: TeacherTimeSlot[] = [];
  const targetDate = new Date(`${dateString}T12:00:00Z`);
  const dayKey = getDayKeyInTimeZone(`${dateString}T12:00:00Z`, viewerTimeZone);

  const dayOfWeekMap: Record<string, DayOfWeek> = {
    mon: 'monday',
    tue: 'tuesday',
    wed: 'wednesday',
    thu: 'thursday',
    fri: 'friday',
    sat: 'saturday',
    sun: 'sunday',
  };

  const currentDayOfWeek = dayOfWeekMap[dayKey] || 'monday';

  const allowedDays = teacherSettings.availableDays || [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
  ];

  if (!allowedDays.includes(currentDayOfWeek)) {
    return [];
  }

  // Retrieve enabled slots for this day from settings
  let enabledTimeSlots: string[] = [];
  const daySchedule =
    teacherSettings.availability?.[currentDayOfWeek] ||
    teacherSettings.availableHoursByDay?.[currentDayOfWeek];

  if (daySchedule && Array.isArray(daySchedule)) {
    enabledTimeSlots = daySchedule;
  } else if (
    teacherSettings.availableHours &&
    teacherSettings.availableHours.length > 0
  ) {
    enabledTimeSlots = teacherSettings.availableHours;
  } else {
    // Default 08:00 to 18:00 (every 30 mins)
    for (let h = 8; h < 18; h++) {
      const hStr = String(h).padStart(2, '0');
      enabledTimeSlots.push(`${hStr}:00`);
      enabledTimeSlots.push(`${hStr}:30`);
    }
  }

  if (enabledTimeSlots.length === 0) {
    return [];
  }

  const cleanExistingLessons = deduplicateLessons(existingLessons);

  for (const timeStr of enabledTimeSlots) {
    const [h, m] = timeStr.split(':').map(Number);
    const slotStart = new Date(`${dateString}T${timeStr}:00`);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

    const slotStartMs = slotStart.getTime();
    const slotEndMs = slotEnd.getTime();

    let isAvailable = true;
    let conflictReason: string | undefined = undefined;

    // Check conflict with Google Calendar busy events
    for (const event of busyEvents) {
      if (event.start?.dateTime && event.end?.dateTime) {
        const evStart = new Date(event.start.dateTime).getTime();
        const evEnd = new Date(event.end.dateTime).getTime();

        if (slotStartMs < evEnd && slotEndMs > evStart) {
          isAvailable = false;
          conflictReason = 'Busy on Google Calendar';
          break;
        }
      }
    }

    // Check collision with existing scheduled lessons in the app
    if (isAvailable) {
      for (const lesson of cleanExistingLessons) {
        if (lesson.id === excludeLessonId || lesson.status !== 'scheduled' || isLessonCancelled(lesson)) {
          continue;
        }

        const lTeacher = (lesson.teacherEmail || '').toLowerCase().trim();
        const lStudent = (lesson.studentEmail || '').toLowerCase().trim();
        const curTeacher = (teacherSettings.teacherEmail || '').toLowerCase().trim();
        const curStudent = (studentEmail || '').toLowerCase().trim();

        const matchTeacher = lTeacher && curTeacher && lTeacher === curTeacher;
        const matchStudent = lStudent && curStudent && lStudent === curStudent;

        if (matchTeacher || matchStudent) {
          const lStart = new Date(lesson.startDateTime).getTime();
          const lEnd = new Date(lesson.endDateTime).getTime();

          if (slotStartMs < lEnd && slotEndMs > lStart) {
            isAvailable = false;
            conflictReason = matchTeacher ? 'Teacher booked' : 'Student booked';
            break;
          }
        }
      }
    }

    // For 50-minute lessons, ensure consecutive slot is also open and present
    if (isAvailable && durationMinutes === 50) {
      const nextMin = m + 30;
      const nextH = h + Math.floor(nextMin / 60);
      const nextM = nextMin % 60;
      const nextTimeStr = `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`;
      if (!enabledTimeSlots.includes(nextTimeStr)) {
        isAvailable = false;
        conflictReason = 'Consecutive block not in schedule';
      }
    }

    slots.push({
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
      formattedTime: timeStr,
      isAvailable,
      conflictReason,
    });
  }

  return slots;
}

export function generateGoogleCalendarWebLink(details: {
  title: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  studentEmail?: string;
  studentName?: string;
  teacherEmail?: string;
  teacherName?: string;
  meetLink?: string;
}): string {
  const startIso = new Date(details.startDateTime)
    .toISOString()
    .replace(/-|:|\.\d+/g, '');
  const endIso = new Date(details.endDateTime)
    .toISOString()
    .replace(/-|:|\.\d+/g, '');

  const effectiveMeet = details.meetLink || 'https://meet.google.com/new';
  const text = encodeURIComponent(details.title);
  const desc = encodeURIComponent(
    `${details.description || ''}\n\nGoogle Meet: ${effectiveMeet}\nStudent: ${details.studentName || ''} (${details.studentEmail || ''})\nTeacher / Native Friend: ${details.teacherName || ''} (${details.teacherEmail || ''})`
  );
  const location = encodeURIComponent(effectiveMeet);

  const attendees: string[] = [];
  if (details.teacherEmail && details.teacherEmail.includes('@')) {
    attendees.push(details.teacherEmail.trim());
  }
  if (details.studentEmail && details.studentEmail.includes('@')) {
    attendees.push(details.studentEmail.trim());
  }
  const uniqueAttendees = Array.from(new Set(attendees));
  const addParam = uniqueAttendees.length > 0 ? `&add=${encodeURIComponent(uniqueAttendees.join(','))}` : '';

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${startIso}/${endIso}&details=${desc}&location=${location}${addParam}`;
}

export function downloadIcsFile(details: {
  title: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  studentEmail?: string;
  studentName?: string;
  teacherEmail?: string;
  teacherName?: string;
  meetLink?: string;
}) {
  const start = new Date(details.startDateTime)
    .toISOString()
    .replace(/-|:|\.\d+/g, '');
  const end = new Date(details.endDateTime)
    .toISOString()
    .replace(/-|:|\.\d+/g, '');

  const attendeesLines: string[] = [];
  if (details.teacherEmail) {
    attendeesLines.push(
      `ATTENDEE;CN=${details.teacherName || 'Teacher'};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${details.teacherEmail}`
    );
  }
  if (details.studentEmail) {
    attendeesLines.push(
      `ATTENDEE;CN=${details.studentName || 'Student'};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${details.studentEmail}`
    );
  }

  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//It's Simple//English Learning//EN
BEGIN:VEVENT
UID:${Date.now()}@itssimple.app
DTSTAMP:${start}
DTSTART:${start}
DTEND:${end}
SUMMARY:${details.title}
DESCRIPTION:${(details.description || '').replace(/\n/g, '\\n')}
LOCATION:${details.meetLink || 'https://meet.google.com/new'}
${attendeesLines.join('\n')}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lesson-${details.title.toLowerCase().replace(/\s+/g, '-')}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
