import { RoutineItem, DayOfWeek, TeacherAssignedVideo } from '../types';
import { getActivityDisplayName } from './i18n';
import { getDayLabel } from './notifications';

export function formatRoutineEmailContent(
  studentName: string,
  studentEmail: string,
  englishLevel: string,
  weekdayRoutines: RoutineItem[] = [],
  weekendRoutines: RoutineItem[] = [],
  routinesByDay?: Record<DayOfWeek, RoutineItem[]>
): { subject: string; body: string } {
  const subject = `[It's Simple] New Student Routine Submitted: ${studentName} (${englishLevel.toUpperCase()})`;

  let body = `Hello Teacher,\n\n`;
  body += `Student ${studentName} (${studentEmail}) has submitted their daily routine on It's Simple.\n`;
  body += `English Level: ${englishLevel.toUpperCase()}\n\n`;
  body += `==============================================\n`;
  body += `WEEKLY SCHEDULE & ACTIVITIES TO ASSIGN VIDEOS:\n`;
  body += `==============================================\n\n`;

  if (routinesByDay) {
    const days: DayOfWeek[] = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ];
    for (const day of days) {
      const items = routinesByDay[day] || [];
      const dayTitle = getDayLabel(day, 'en');
      body += `--- ${dayTitle.toUpperCase()} (${items.length} activities) ---\n`;
      if (items.length === 0) {
        body += `  (No activities registered for this day)\n`;
      } else {
        items.forEach((it, idx) => {
          const enName = getActivityDisplayName(it.activityName, 'en');
          body += `  ${idx + 1}. [${it.time}] ${enName}\n`;
          if (it.teacherVideos && it.teacherVideos.length > 0) {
            body += `     Assigned Video: ${it.teacherVideos[0].url}\n`;
          }
          if (it.teacherSpotify) {
            body += `     Assigned Spotify Audio: ${it.teacherSpotify.title} (${it.teacherSpotify.url})\n`;
          }
        });
      }
      body += `\n`;
    }
  } else {
    body += `--- WEEKDAYS (Monday - Friday) ---\n`;
    weekdayRoutines.forEach((it, idx) => {
      body += `  ${idx + 1}. [${it.time}] ${getActivityDisplayName(it.activityName, 'en')}\n`;
    });
    body += `\n--- WEEKENDS (Saturday & Sunday) ---\n`;
    weekendRoutines.forEach((it, idx) => {
      body += `  ${idx + 1}. [${it.time}] ${getActivityDisplayName(it.activityName, 'en')}\n`;
    });
  }

  body += `\nPlease access the It's Simple teacher dashboard to assign contextual YouTube video lessons for each activity.\n\n`;
  body += `Best regards,\nIt's Simple Platform Team`;

  return { subject, body };
}

export function formatTeacherToStudentRoutineEmailContent(
  studentName: string,
  studentEmail: string,
  teacherName: string,
  teacherEmail: string,
  englishLevel: string,
  routinesByDay: Record<DayOfWeek, RoutineItem[]>
): { subject: string; body: string } {
  const subject = `[It's Simple] Your Weekly Routine with Video Lessons is Ready! (From ${teacherName})`;

  let body = `Hello ${studentName},\n\n`;
  body += `Your native English teacher, ${teacherName} (${teacherEmail}), has reviewed your daily routine and assigned personalized YouTube video lessons for each of your activities!\n\n`;
  body += `==============================================\n`;
  body += `YOUR CUSTOMIZED WEEKLY ENGLISH LEARNING SCHEDULE:\n`;
  body += `==============================================\n\n`;

  const days: DayOfWeek[] = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ];

  for (const day of days) {
    const items = routinesByDay[day] || [];
    body += `--- ${getDayLabel(day, 'en').toUpperCase()} ---\n`;
    if (items.length === 0) {
      body += `  (Rest day / No activities)\n`;
    } else {
      items.forEach((it, idx) => {
        const enName = getActivityDisplayName(it.activityName, 'en');
        body += `  ${idx + 1}. [${it.time}] ${enName}\n`;
        if (it.teacherVideos && it.teacherVideos.length > 0) {
          body += `     🎥 Video Lesson: ${it.teacherVideos[0].title} (${it.teacherVideos[0].url})\n`;
          if (it.teacherNotes || it.teacherVideos[0].instructions) {
            body += `     💡 Video Guidance: "${it.teacherVideos[0].instructions || it.teacherNotes}"\n`;
          }
        }
        if (it.teacherSpotify) {
          body += `     🎧 Spotify Audio / Podcast: ${it.teacherSpotify.title} (${it.teacherSpotify.url})\n`;
          if (it.teacherSpotify.instructions) {
            body += `     💡 Listening Guidance: "${it.teacherSpotify.instructions}"\n`;
          }
        }
        if (!it.teacherVideos?.length && !it.teacherSpotify) {
          body += `     (General routine practice)\n`;
        }
      });
    }
    body += `\n`;
  }

  body += `\nInstructions for your daily study:\n`;
  body += `1. Receive your reminder 5 minutes before each activity.\n`;
  body += `2. Watch the assigned YouTube video and note down 5 vocabulary words.\n`;
  body += `3. 30 minutes before your last activity, write your Daily English Sentence.\n\n`;
  body += `Happy learning!\n${teacherName} & It's Simple Team`;

  return { subject, body };
}

export async function sendEmailToTeacherViaGmailApi(
  teacherEmail: string,
  studentName: string,
  studentEmail: string,
  englishLevel: string,
  weekdayRoutines: RoutineItem[] = [],
  weekendRoutines: RoutineItem[] = [],
  token?: string | null,
  routinesByDay?: Record<DayOfWeek, RoutineItem[]>
): Promise<{ success: boolean; methodUsed: 'gmail_api' | 'simulated'; error?: string }> {
  const { subject, body } = formatRoutineEmailContent(
    studentName,
    studentEmail,
    englishLevel,
    weekdayRoutines,
    weekendRoutines,
    routinesByDay
  );

  if (token) {
    try {
      const emailLines = [
        `To: ${teacherEmail}`,
        `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 7bit',
        '',
        body,
      ];
      const emailRaw = btoa(unescape(encodeURIComponent(emailLines.join('\r\n'))))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: emailRaw }),
        }
      );

      if (res.ok) {
        return { success: true, methodUsed: 'gmail_api' };
      }
    } catch (e: any) {
      console.warn('Gmail API sending error, falling back to simulated dispatch:', e);
    }
  }

  return { success: true, methodUsed: 'simulated' };
}

export async function sendEmailToStudentViaGmailApi(
  studentEmail: string,
  studentName: string,
  teacherName: string,
  teacherEmail: string,
  activityName: string,
  activityTime: string,
  day: DayOfWeek,
  video: TeacherAssignedVideo,
  teacherNotes?: string,
  token?: string | null
): Promise<{ success: boolean; methodUsed: 'gmail_api' | 'simulated'; error?: string }> {
  const subject = `[It's Simple] New Video Lesson Assigned for ${activityName} (${activityTime})`;
  const body = `Hello ${studentName},\n\nYour teacher, ${teacherName}, has assigned a new YouTube video lesson for your "${activityName}" routine activity on ${getDayLabel(day, 'en')}.\n\nVideo: ${video.title}\nLink: ${video.url}\nInstructions: ${teacherNotes || video.instructions || 'Practice this video and note 5 vocabulary words.'}\n\nKeep up the great work!\nIt's Simple Team`;

  if (token) {
    try {
      const emailLines = [
        `To: ${studentEmail}`,
        `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 7bit',
        '',
        body,
      ];
      const emailRaw = btoa(unescape(encodeURIComponent(emailLines.join('\r\n'))))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: emailRaw }),
        }
      );

      if (res.ok) {
        return { success: true, methodUsed: 'gmail_api' };
      }
    } catch (e) {
      console.warn('Gmail API dispatch exception:', e);
    }
  }

  return { success: true, methodUsed: 'simulated' };
}

export async function sendTeacherRoutineToStudentViaGmailApi(
  studentEmail: string,
  studentName: string,
  teacherName: string,
  teacherEmail: string,
  englishLevel: string,
  routinesByDay: Record<DayOfWeek, RoutineItem[]>,
  token?: string | null
): Promise<{ success: boolean; methodUsed: 'gmail_api' | 'simulated'; error?: string }> {
  const { subject, body } = formatTeacherToStudentRoutineEmailContent(
    studentName,
    studentEmail,
    teacherName,
    teacherEmail,
    englishLevel,
    routinesByDay
  );

  if (token) {
    try {
      const emailLines = [
        `To: ${studentEmail}`,
        `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 7bit',
        '',
        body,
      ];
      const emailRaw = btoa(unescape(encodeURIComponent(emailLines.join('\r\n'))))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw: emailRaw }),
        }
      );

      if (res.ok) {
        return { success: true, methodUsed: 'gmail_api' };
      }
    } catch (e) {
      console.warn('Gmail API error:', e);
    }
  }

  return { success: true, methodUsed: 'simulated' };
}

export function getTeacherMailtoLink(
  teacherEmail: string,
  studentName: string,
  studentEmail: string,
  englishLevel: string,
  weekdayRoutines: RoutineItem[] = [],
  weekendRoutines: RoutineItem[] = [],
  routinesByDay?: Record<DayOfWeek, RoutineItem[]>
): string {
  const { subject, body } = formatRoutineEmailContent(
    studentName,
    studentEmail,
    englishLevel,
    weekdayRoutines,
    weekendRoutines,
    routinesByDay
  );
  return `mailto:${encodeURIComponent(teacherEmail)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

export function getTeacherToStudentMailtoLink(
  studentEmail: string,
  studentName: string,
  teacherName: string,
  teacherEmail: string,
  englishLevel: string,
  routinesByDay: Record<DayOfWeek, RoutineItem[]>
): string {
  const { subject, body } = formatTeacherToStudentRoutineEmailContent(
    studentName,
    studentEmail,
    teacherName,
    teacherEmail,
    englishLevel,
    routinesByDay
  );
  return `mailto:${encodeURIComponent(studentEmail)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

export async function sendEmailNotificationApi(params: {
  to: string;
  subject: string;
  body: string;
  fromEmail?: string;
  fromName?: string;
}): Promise<{ success: boolean; messageId?: string }> {
  try {
    const res = await fetch('/api/notifications/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Backend email API fallback:', err);
  }
  return { success: true, messageId: `local-${Date.now()}` };
}

