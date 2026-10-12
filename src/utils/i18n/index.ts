import { Language } from '../../types';
import { Translations, LanguageOption } from './types';
import { PT_TRANSLATIONS } from './languages/pt';
import { EN_TRANSLATIONS } from './languages/en';
import { ES_TRANSLATIONS } from './languages/es';
import { FR_TRANSLATIONS } from './languages/fr';
import { DE_TRANSLATIONS } from './languages/de';
import { IT_TRANSLATIONS } from './languages/it';
import { JA_TRANSLATIONS } from './languages/ja';
import { KO_TRANSLATIONS } from './languages/ko';
import { ZH_TRANSLATIONS } from './languages/zh';
import { RU_TRANSLATIONS } from './languages/ru';
import { AR_TRANSLATIONS } from './languages/ar';
import { TR_TRANSLATIONS } from './languages/tr';

export * from './types';
export * from './memorizationActivity';

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', nativeName: 'English (US/UK)', flag: '🇺🇸', region: 'Global' },
  { code: 'pt', name: 'Português', nativeName: 'Português (Brasil)', flag: '🇧🇷', region: 'Brasil' },
  { code: 'es', name: 'Español', nativeName: 'Español', flag: '🇪🇸', region: 'Hispanoamérica & España' },
  { code: 'fr', name: 'Français', nativeName: 'Français', flag: '🇫🇷', region: 'France & Canada' },
  { code: 'de', name: 'Deutsch', nativeName: 'Deutsch', flag: '🇩🇪', region: 'Deutschland & Österreich' },
  { code: 'it', name: 'Italiano', nativeName: 'Italiano', flag: '🇮🇹', region: 'Italia' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', region: '日本' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷', region: '대한민국' },
  { code: 'zh', name: 'Chinese', nativeName: '中文 (简体)', flag: '🇨🇳', region: '中国 / 华人地区' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', region: 'Россия & СНГ' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', region: 'الشرق الأوسط' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷', region: 'Türkiye' },
];

export const TRANSLATION_MAP: Record<Language, Translations> = {
  pt: PT_TRANSLATIONS,
  en: EN_TRANSLATIONS,
  es: ES_TRANSLATIONS,
  fr: FR_TRANSLATIONS,
  de: DE_TRANSLATIONS,
  it: IT_TRANSLATIONS,
  ja: JA_TRANSLATIONS,
  ko: KO_TRANSLATIONS,
  zh: ZH_TRANSLATIONS,
  ru: RU_TRANSLATIONS,
  ar: AR_TRANSLATIONS,
  tr: TR_TRANSLATIONS,
};

export const getTranslations = (lang: Language): Translations => {
  return TRANSLATION_MAP[lang] || EN_TRANSLATIONS;
};

// Localized activity names
const ACTIVITY_NAMES_MAP: Record<string, Record<Language, string>> = {
  'cafe-manha': {
    pt: 'Café da Manhã',
    en: 'Breakfast',
    es: 'Desayuno',
    fr: 'Petit-déjeuner',
    de: 'Frühstück',
    it: 'Colazione',
    ja: '朝食',
    ko: '아침 식사',
    zh: '早餐',
    ru: 'Завтрак',
    ar: 'الإفطار',
    tr: 'Kahvaltı',
  },
  'transporte': {
    pt: 'No Transporte',
    en: 'Commute',
    es: 'En el Transporte',
    fr: 'Dans les Transports',
    de: 'Unterwegs / Pendeln',
    it: 'Nei Trasporti',
    ja: '通勤・移動',
    ko: '이동 / 통근',
    zh: '通勤途中',
    ru: 'В дороге',
    ar: 'أثناء التنقل',
    tr: 'Yolda / Ulaşım',
  },
  'trabalho': {
    pt: 'No Trabalho',
    en: 'At Work',
    es: 'En el Trabajo',
    fr: 'Au Travail',
    de: 'Bei der Arbeit',
    it: 'Al Lavoro',
    ja: '仕事中',
    ko: '근무 중',
    zh: '工作时间',
    ru: 'На работе',
    ar: 'في العمل',
    tr: 'İşte',
  },
  'almoco': {
    pt: 'Almoço',
    en: 'Lunch',
    es: 'Almuerzo',
    fr: 'Déjeuner',
    de: 'Mittagessen',
    it: 'Pranzo',
    ja: '昼食',
    ko: '점심 식사',
    zh: '午餐',
    ru: 'Обед',
    ar: 'الغداء',
    tr: 'Öğle Yemeği',
  },
  'academia': {
    pt: 'Academia',
    en: 'Gym / Workout',
    es: 'Gimnasio',
    fr: 'Salle de sport',
    de: 'Fitnessstudio',
    it: 'Palestra',
    ja: 'ジム・運動',
    ko: '운동 / 헬스',
    zh: '健身运动',
    ru: 'Спортзал',
    ar: 'النادي الرياضي',
    tr: 'Spor Salonu',
  },
  'descanso-noite': {
    pt: 'Descanso da Noite',
    en: 'Evening Relax',
    es: 'Descanso de la Noche',
    fr: 'Détente du Soir',
    de: 'Abendruhe',
    it: 'Relax Serale',
    ja: '夜のリラックス',
    ko: '저녁 휴식',
    zh: '晚间放松',
    ru: 'Вечерний отдых',
    ar: 'استرخاء المساء',
    tr: 'Akşam Dinlenmesi',
  },
};

export const getActivityDisplayName = (
  activity: string | { activityName?: string; id?: string } | null | undefined,
  lang: Language
): string => {
  if (!activity) return '';
  const key = typeof activity === 'string' ? activity : (activity.activityName || activity.id || '');
  if (key && ACTIVITY_NAMES_MAP[key] && ACTIVITY_NAMES_MAP[key][lang]) {
    return ACTIVITY_NAMES_MAP[key][lang];
  }
  return typeof activity === 'string' ? activity : (activity.activityName || activity.id || '');
};
