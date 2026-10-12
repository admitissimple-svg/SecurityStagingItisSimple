import { DayOfWeek, Language, RoutineItem } from '../types';
import { getStudentCurrentDayOfWeek, DEFAULT_STUDENT_TIMEZONE } from './timezone';

export const DAYS_OF_WEEK: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export const WEEKDAY_DAYS: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
];

export const WEEKEND_DAYS: DayOfWeek[] = ['saturday', 'sunday'];

export function isWeekend(date: Date = new Date(), timeZone: string = DEFAULT_STUDENT_TIMEZONE): boolean {
  const day = getStudentCurrentDayOfWeek(timeZone, date);
  return day === 'saturday' || day === 'sunday';
}

export function getTodayDayOfWeek(date: Date = new Date(), timeZone: string = DEFAULT_STUDENT_TIMEZONE): DayOfWeek {
  return getStudentCurrentDayOfWeek(timeZone, date);
}

export function getDayLabel(day: DayOfWeek, lang: Language = 'pt'): string {
  const labels: Record<DayOfWeek, Record<Language, string>> = {
    monday: {
      pt: 'Segunda-feira',
      en: 'Monday',
      es: 'Lunes',
      fr: 'Lundi',
      de: 'Montag',
      it: 'Lunedì',
      ja: '月曜日',
      ko: '월요일',
      zh: '星期一',
      ru: 'Понедельник',
      ar: 'الإثنين',
      tr: 'Pazartesi',
    },
    tuesday: {
      pt: 'Terça-feira',
      en: 'Tuesday',
      es: 'Martes',
      fr: 'Mardi',
      de: 'Dienstag',
      it: 'Martedì',
      ja: '火曜日',
      ko: '화요일',
      zh: '星期二',
      ru: 'Вторник',
      ar: 'الثلاثاء',
      tr: 'Salı',
    },
    wednesday: {
      pt: 'Quarta-feira',
      en: 'Wednesday',
      es: 'Miércoles',
      fr: 'Mercredi',
      de: 'Mittwoch',
      it: 'Mercoledì',
      ja: '水曜日',
      ko: '수요일',
      zh: '星期三',
      ru: 'Среда',
      ar: 'الأربعاء',
      tr: 'Çarşamba',
    },
    thursday: {
      pt: 'Quinta-feira',
      en: 'Thursday',
      es: 'Jueves',
      fr: 'Jeudi',
      de: 'Donnerstag',
      it: 'Giovedì',
      ja: '木曜日',
      ko: '목요일',
      zh: '星期四',
      ru: 'Четверг',
      ar: 'الخميس',
      tr: 'Perşembe',
    },
    friday: {
      pt: 'Sexta-feira',
      en: 'Friday',
      es: 'Viernes',
      fr: 'Vendredi',
      de: 'Freitag',
      it: 'Venerdì',
      ja: '金曜日',
      ko: '금요일',
      zh: '星期五',
      ru: 'Пятница',
      ar: 'الجمعة',
      tr: 'Cuma',
    },
    saturday: {
      pt: 'Sábado',
      en: 'Saturday',
      es: 'Sábado',
      fr: 'Samedi',
      de: 'Samstag',
      it: 'Sabato',
      ja: '土曜日',
      ko: '토요일',
      zh: '星期六',
      ru: 'Суббота',
      ar: 'السبت',
      tr: 'Cumartesi',
    },
    sunday: {
      pt: 'Domingo',
      en: 'Sunday',
      es: 'Domingo',
      fr: 'Dimanche',
      de: 'Sonntag',
      it: 'Domenica',
      ja: '日曜日',
      ko: '일요일',
      zh: '星期日',
      ru: 'Воскресенье',
      ar: 'الأحد',
      tr: 'Pazar',
    },
  };
  return labels[day]?.[lang] || labels[day]?.en || day;
}

export function getDayShortLabel(day: DayOfWeek, lang: Language = 'pt'): string {
  const shortLabels: Record<DayOfWeek, Record<Language, string>> = {
    monday: {
      pt: 'Seg',
      en: 'Mon',
      es: 'Lun',
      fr: 'Lun',
      de: 'Mo',
      it: 'Lun',
      ja: '月',
      ko: '월',
      zh: '周一',
      ru: 'Пн',
      ar: 'إثن',
      tr: 'Pzt',
    },
    tuesday: {
      pt: 'Ter',
      en: 'Tue',
      es: 'Mar',
      fr: 'Mar',
      de: 'Di',
      it: 'Mar',
      ja: '火',
      ko: '화',
      zh: '周二',
      ru: 'Вт',
      ar: 'ثلا',
      tr: 'Sal',
    },
    wednesday: {
      pt: 'Qua',
      en: 'Wed',
      es: 'Mié',
      fr: 'Mer',
      de: 'Mi',
      it: 'Mer',
      ja: '水',
      ko: '수',
      zh: '周三',
      ru: 'Ср',
      ar: 'أرب',
      tr: 'Çar',
    },
    thursday: {
      pt: 'Qui',
      en: 'Thu',
      es: 'Jue',
      fr: 'Jeu',
      de: 'Do',
      it: 'Gio',
      ja: '木',
      ko: '목',
      zh: '周四',
      ru: 'Чт',
      ar: 'خميس',
      tr: 'Per',
    },
    friday: {
      pt: 'Sex',
      en: 'Fri',
      es: 'Vie',
      fr: 'Ven',
      de: 'Fr',
      it: 'Ven',
      ja: '金',
      ko: '금',
      zh: '周五',
      ru: 'Пт',
      ar: 'جمع',
      tr: 'Cum',
    },
    saturday: {
      pt: 'Sáb',
      en: 'Sat',
      es: 'Sáb',
      fr: 'Sam',
      de: 'Sa',
      it: 'Sab',
      ja: '土',
      ko: '토',
      zh: '周六',
      ru: 'Сб',
      ar: 'سبت',
      tr: 'Cmt',
    },
    sunday: {
      pt: 'Dom',
      en: 'Sun',
      es: 'Dom',
      fr: 'Dim',
      de: 'So',
      it: 'Dom',
      ja: '日',
      ko: '일',
      zh: '周日',
      ru: 'Вс',
      ar: 'أحد',
      tr: 'Paz',
    },
  };
  return shortLabels[day]?.[lang] || shortLabels[day]?.en || day;
}

export function getMinutesUntilTime(timeStr: string, fromDate: Date = new Date()): number {
  if (!timeStr || !timeStr.includes(':')) return 999;
  const [h, m] = timeStr.split(':').map(Number);
  const nowH = fromDate.getHours();
  const nowM = fromDate.getMinutes();
  const nowSec = fromDate.getSeconds();

  const targetMinutes = h * 60 + m;
  const currentMinutes = nowH * 60 + nowM + nowSec / 60;

  return Math.round(targetMinutes - currentMinutes);
}

export function getNextUpcomingActivity(
  items: RoutineItem[]
): { item: RoutineItem; minutesLeft: number } | null {
  if (!items || items.length === 0) return null;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const futureItems: Array<{ item: RoutineItem; minutesLeft: number }> = [];

  for (const it of items) {
    const [h, m] = it.time.split(':').map(Number);
    const itemMinutes = h * 60 + m;
    const diff = itemMinutes - currentMinutes;

    if (diff >= -5) {
      // either coming up in future or within 5 min window
      futureItems.push({
        item: it,
        minutesLeft: diff,
      });
    }
  }

  futureItems.sort((a, b) => a.minutesLeft - b.minutesLeft);
  return futureItems.length > 0 ? futureItems[0] : null;
}

export function getLastActivityOfTheDay(items: RoutineItem[]): RoutineItem | null {
  if (!items || items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.time.localeCompare(b.time));
  return sorted[sorted.length - 1];
}

export function getEndOfDayReminderTime(lastActivityTimeStr: string): string {
  if (!lastActivityTimeStr || !lastActivityTimeStr.includes(':')) return '21:30';
  const [h, m] = lastActivityTimeStr.split(':').map(Number);
  let totalMin = h * 60 + m - 30; // 30 minutes before
  if (totalMin < 0) totalMin += 24 * 60;
  const rh = Math.floor(totalMin / 60);
  const rm = totalMin % 60;
  return `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}`;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'default';
  }
}

export function sendBrowserNotification(title: string, options?: NotificationOptions): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      new Notification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        ...options,
      });
    } catch (e) {
      console.warn('Browser notification failed:', e);
    }
  }
}
