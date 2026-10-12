import React, { useState } from 'react';
import {
  Coffee,
  Headphones,
  Utensils,
  MessageSquare,
  Film,
  Sparkles,
  CheckCircle2,
  Heart,
  Flame,
  ArrowRight,
} from 'lucide-react';
import { Language } from '../types';
import { getTranslations } from '../utils/i18n';

interface EnglishMomentsShowcaseProps {
  currentLanguage: Language;
  onExploreRoutines?: () => void;
  onFindTutors?: () => void;
}

interface MomentItem {
  id: string;
  icon: any;
  timeOfDay: Record<Language, string>;
  title: Record<Language, string>;
  desc: Record<Language, string>;
  actionText: Record<Language, string>;
  tag: Record<Language, string>;
  color: string;
  bgColor: string;
}

const MOMENTS: MomentItem[] = [
  {
    id: 'morning',
    icon: Coffee,
    timeOfDay: {
      pt: '07:30 - Manhã',
      en: '07:30 AM - Morning',
      es: '07:30 - Mañana',
      fr: '07:30 - Matin',
      de: '07:30 - Morgen',
      it: '07:30 - Mattina',
      ja: '07:30 - 朝',
      ko: '07:30 - 아침',
      zh: '07:30 - 早晨',
      ru: '07:30 - Утро',
      ar: '07:30 - الصباح',
      tr: '07:30 - Sabah',
    },
    title: {
      pt: 'Your Morning English Moment ☕',
      en: 'Your Morning English Moment ☕',
      es: 'Your Morning English Moment ☕',
      fr: 'Your Morning English Moment ☕',
      de: 'Your Morning English Moment ☕',
      it: 'Your Morning English Moment ☕',
      ja: 'Your Morning English Moment ☕',
      ko: 'Your Morning English Moment ☕',
      zh: 'Your Morning English Moment ☕',
      ru: 'Your Morning English Moment ☕',
      ar: 'Your Morning English Moment ☕',
      tr: 'Your Morning English Moment ☕',
    },
    desc: {
      pt: 'Tome seu café ouvindo um áudio curto de 3 minutos em inglês sobre curiosidades do mundo.',
      en: 'Listen to something in English while brewing your morning coffee. Zero pressure, pure rhythm.',
      es: 'Toma tu café escuchando un audio corto de 3 minutos en inglés. Cero presión, ritmo puro.',
      fr: 'Savourez votre café en écoutant 3 minutes d\'anglais. Sans pression, que du naturel.',
      de: 'Trinke deinen Kaffee und lausche 3 Minuten englischem Audio. Kein Zwang, reiner Rhythmus.',
      it: 'Bevi il caffè ascoltando un breve audio di 3 minuti in inglese. Zero stress, solo ritmo.',
      ja: '朝のコーヒーを淹れながら3分間の英語音声を聞く。プレッシャーなく自然なリズムで。',
      ko: '모닝 커피를 마시며 3분간 가벼운 영어 오디오를 들어보세요. 부담 없이 자연스럽게.',
      zh: '边冲泡早间咖啡边听3分钟地道英语短音频。毫无压力，自然融入。',
      ru: 'Пейте утренний кофе и слушайте 3 минуты английской речи. Без давления, легко и непринужденно.',
      ar: 'استمتع بقهوتك الصباحية مع 3 دقائق من الصوت الإنجليزي الطبيعي. بدون ضغوط، فقط سلاسة.',
      tr: 'Sabah kahvenizi yudumlarken 3 dakikalık İngilizce bir ses kaydı dinleyin. Sıfır baskı, saf ritim.',
    },
    actionText: {
      pt: '☕ Tomar café ouvindo inglês',
      en: '☕ Sip coffee & listen to English',
      es: '☕ Tomar café escuchando inglés',
      fr: '☕ Café & écoute en anglais',
      de: '☕ Kaffee trinken & Englisch hören',
      it: '☕ Caffè & ascolto in inglese',
      ja: '☕ コーヒーを飲みながら英語を聞く',
      ko: '☕ 커피 마시며 영어 듣기',
      zh: '☕ 边喝咖啡边听英文',
      ru: '☕ Пить кофе и слушать английский',
      ar: '☕ شرب القهوة والاستماع للإنجليزية',
      tr: '☕ Kahve içerken İngilizce dinle',
    },
    tag: {
      pt: '3 min • Rotina',
      en: '3 min • Daily Routine',
      es: '3 min • Rutina',
      fr: '3 min • Routine',
      de: '3 Min • Routine',
      it: '3 min • Routine',
      ja: '3分 • 日常',
      ko: '3분 • 일상 루틴',
      zh: '3分钟 • 日常',
      ru: '3 мин • Рутина',
      ar: '3 دقائق • روتين',
      tr: '3 dk • Rutin',
    },
    color: 'text-amber-700',
    bgColor: 'bg-amber-50 border-amber-200',
  },
  {
    id: 'commute',
    icon: Headphones,
    timeOfDay: {
      pt: '08:30 - No Caminho',
      en: '08:30 AM - Commute',
      es: '08:30 - En el Transporte',
      fr: '08:30 - Trajet',
      de: '08:30 - Unterwegs',
      it: '08:30 - Nel Tragitto',
      ja: '08:30 - 移動中',
      ko: '08:30 - 출근/이동',
      zh: '08:30 - 通勤路上',
      ru: '08:30 - В дороге',
      ar: '08:30 - أثناء التنقل',
      tr: '08:30 - Yolda',
    },
    title: {
      pt: 'Your Commute English Moment 🎧',
      en: 'Your Commute English Moment 🎧',
      es: 'Your Commute English Moment 🎧',
      fr: 'Your Commute English Moment 🎧',
      de: 'Your Commute English Moment 🎧',
      it: 'Your Commute English Moment 🎧',
      ja: 'Your Commute English Moment 🎧',
      ko: 'Your Commute English Moment 🎧',
      zh: 'Your Commute English Moment 🎧',
      ru: 'Your Commute English Moment 🎧',
      ar: 'Your Commute English Moment 🎧',
      tr: 'Your Commute English Moment 🎧',
    },
    desc: {
      pt: 'Ouça sua música favorita ou podcast em inglês no trânsito, metrô ou caminhada.',
      en: 'Listen to a conversational podcast or favorite song on your way to work.',
      es: 'Escucha tu podcast o canción favorita en inglés en el transporte o caminata.',
      fr: 'Écoutez un podcast ou votre chanson préférée en anglais pendant votre trajet.',
      de: 'Höre einen Podcast oder deinen Lieblingssong auf dem Weg zur Arbeit.',
      it: 'Ascolta un podcast o il tuo brano preferito in inglese durante il tragitto.',
      ja: '通勤や散歩の途中でポッドキャストやお気に入りの洋楽を聴く。',
      ko: '이동 중 팟캐스트나 좋아하는 영어 팝송을 가볍게 들어보세요.',
      zh: '在通勤途中或散步时，收听英语对话播客或喜爱的英文歌。',
      ru: 'Слушайте разговорный подкаст или песню по пути на работу или учебу.',
      ar: 'استمع لبودكاست حواري أو أغانيك المفضلة بالإنجليزية أثناء تنقلك.',
      tr: 'Yolda veya yürüyüşte İngilizce bir podcast veya sevdiğiniz bir şarkıyı dinleyin.',
    },
    actionText: {
      pt: '🎵 Ouvir música ou podcast',
      en: '🎵 Listen to music or podcast',
      es: '🎵 Escuchar música o podcast',
      fr: '🎵 Musique ou podcast',
      de: '🎵 Musik oder Podcast hören',
      it: '🎵 Ascolta musica o podcast',
      ja: '🎵 音楽やポッドキャストを聴く',
      ko: '🎵 음악 또는 팟캐스트 듣기',
      zh: '🎵 听音乐或播客',
      ru: '🎵 Музыка или подкаст',
      ar: '🎵 استماع لموسيقى أو بودكاست',
      tr: '🎵 Müzik veya podcast dinle',
    },
    tag: {
      pt: '5 min • Imersão',
      en: '5 min • Immersion',
      es: '5 min • Inmersión',
      fr: '5 min • Immersion',
      de: '5 Min • Immersion',
      it: '5 min • Immersione',
      ja: '5分 • イマージョン',
      ko: '5분 • 자연 몰입',
      zh: '5分钟 • 沉浸',
      ru: '5 мин • Погружение',
      ar: '5 دقائق • انغماس',
      tr: '5 dk • Daldırma',
    },
    color: 'text-blue-700',
    bgColor: 'bg-blue-50 border-blue-200',
  },
  {
    id: 'lunch',
    icon: Utensils,
    timeOfDay: {
      pt: '12:30 - Almoço',
      en: '12:30 PM - Lunch Break',
      es: '12:30 - Almuerzo',
      fr: '12:30 - Déjeuner',
      de: '12:30 - Mittagspause',
      it: '12:30 - Pranzo',
      ja: '12:30 - 昼休み',
      ko: '12:30 - 점심 시간',
      zh: '12:30 - 午休时光',
      ru: '12:30 - Обед',
      ar: '12:30 - استراحة الغداء',
      tr: '12:30 - Öğle Arası',
    },
    title: {
      pt: 'Your Lunch English Moment 🍽️',
      en: 'Your Lunch English Moment 🍽️',
      es: 'Your Lunch English Moment 🍽️',
      fr: 'Your Lunch English Moment 🍽️',
      de: 'Your Lunch English Moment 🍽️',
      it: 'Your Lunch English Moment 🍽️',
      ja: 'Your Lunch English Moment 🍽️',
      ko: 'Your Lunch English Moment 🍽️',
      zh: 'Your Lunch English Moment 🍽️',
      ru: 'Your Lunch English Moment 🍽️',
      ar: 'Your Lunch English Moment 🍽️',
      tr: 'Your Lunch English Moment 🍽️',
    },
    desc: {
      pt: 'Assista a um vídeo de 5 minutos sobre algo que você ama e anote 5 palavras-chave.',
      en: 'Watch a quick 5-minute video you love and save 5 everyday words.',
      es: 'Mira un video de 5 minutos sobre algo que te guste y anota 5 palabras clave.',
      fr: 'Regardez une vidéo de 5 minutes qui vous passionne et notez 5 mots du quotidien.',
      de: 'Schaue ein 5-Minuten-Video zu einem Lieblingsthema und notiere 5 Alltagswörter.',
      it: 'Guarda un video di 5 minuti che ti appassiona e segna 5 parole utili.',
      ja: '好きなテーマの5分動画を見て、日常で使える5つの単語をメモする。',
      ko: '좋아하는 주제의 5분 영상을 보고 일상 단어 5개를 메모해보세요.',
      zh: '观看一段你喜欢的5分钟短视频，并记录5个生活实用词汇。',
      ru: 'Посмотрите 5-минутное видео на интересную тему и запишите 5 полезных слов.',
      ar: 'شاهد فيديو قصير مدته 5 دقائق تحبه وسجل 5 كلمات يومية بسيطة.',
      tr: 'Sevdiğiniz bir konuda 5 dakikalık bir video izleyin ve 5 günlük kelime not edin.',
    },
    actionText: {
      pt: '📱 Assistir vídeo & 5 palavras',
      en: '📱 Watch video & log 5 words',
      es: '📱 Ver video & 5 palabras',
      fr: '📱 Vidéo & 5 mots',
      de: '📱 Video ansehen & 5 Wörter erfassen',
      it: '📱 Guarda video & 5 parole',
      ja: '📱 動画視聴＆5単語メモ',
      ko: '📱 영상 시청 & 단어 5개 기록',
      zh: '📱 看视频并记5个词',
      ru: '📱 Видео и 5 слов',
      ar: '📱 مشاهدة فيديو وتسجيل 5 كلمات',
      tr: '📱 Video izle ve 5 kelime kaydet',
    },
    tag: {
      pt: '5 min • Vocabulário',
      en: '5 min • Vocabulary',
      es: '5 min • Vocabulario',
      fr: '5 min • Vocabulaire',
      de: '5 Min • Wortschatz',
      it: '5 min • Vocabolario',
      ja: '5分 • 語彙力',
      ko: '5분 • 어휘 확장',
      zh: '5分钟 • 词汇积累',
      ru: '5 мин • Словарный запас',
      ar: '5 دقائق • مفردات',
      tr: '5 dk • Kelime Bilgisi',
    },
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50 border-emerald-200',
  },
  {
    id: 'chat',
    icon: MessageSquare,
    timeOfDay: {
      pt: '16:00 - Tarde',
      en: '04:00 PM - Afternoon',
      es: '16:00 - Tarde',
      fr: '16:00 - Après-midi',
      de: '16:00 - Nachmittag',
      it: '16:00 - Pomeriggio',
      ja: '16:00 - 午後',
      ko: '16:00 - 오후',
      zh: '16:00 - 下午',
      ru: '16:00 - День',
      ar: '16:00 - بعد الظهر',
      tr: '16:00 - Öğleden Sonra',
    },
    title: {
      pt: 'Your Micro-Speaking Moment 🗣️',
      en: 'Your Micro-Speaking Moment 🗣️',
      es: 'Your Micro-Speaking Moment 🗣️',
      fr: 'Your Micro-Speaking Moment 🗣️',
      de: 'Your Micro-Speaking Moment 🗣️',
      it: 'Your Micro-Speaking Moment 🗣️',
      ja: 'Your Micro-Speaking Moment 🗣️',
      ko: 'Your Micro-Speaking Moment 🗣️',
      zh: 'Your Micro-Speaking Moment 🗣️',
      ru: 'Your Micro-Speaking Moment 🗣️',
      ar: 'Your Micro-Speaking Moment 🗣️',
      tr: 'Your Micro-Speaking Moment 🗣️',
    },
    desc: {
      pt: 'Fale sozinho por 2 minutos descrevendo seu dia ou envie um áudio para seu Native Friend.',
      en: 'Speak to yourself for 2 minutes or send a quick voice note to your Native Friend.',
      es: 'Habla solo por 2 minutos describiendo tu día o envía un audio a tu Native Friend.',
      fr: 'Parlez seul pendant 2 minutes pour décrire votre journée ou envoyez un mémo vocal à votre Native Friend.',
      de: 'Sprich 2 Minuten mit dir selbst über deinen Tag oder sende eine Sprachnachricht an deinen Native Friend.',
      it: 'Parla da solo per 2 minuti descrivendo la tua giornata o invia un audio al tuo Native Friend.',
      ja: '今日あったことを2分間独り言で英語で説明するか、Native Friendにボイスメッセージを送る。',
      ko: '2분간 혼잣말로 오늘 일과를 영어로 말해보거나 Native Friend에게 음성 메시지를 보내보세요.',
      zh: '用英语自言自语2分钟描述今天的经历，或给你的Native Friend发一条语音消息。',
      ru: 'Поговорите с собой 2 минуты на английском или отправьте голосовое сообщение своему Native Friend.',
      ar: 'تحدث مع نفسك لدقيقتين واصفاً يومك أو أرسل رسالة صوتية لصديقك الناطق الأصلي.',
      tr: 'Gününüzü anlatarak 2 dakika kendi kendinize konuşun veya Native Friend\'inize bir sesli mesaj gönderin.',
    },
    actionText: {
      pt: '🗣️ Falar sozinho por 2 minutos',
      en: '🗣️ Speak out loud for 2 min',
      es: '🗣️ Hablar solo por 2 min',
      fr: '🗣️ Parler seul 2 min',
      de: '🗣️ 2 Min laut sprechen',
      it: '🗣️ Parla a voce alta 2 min',
      ja: '🗣️ 2分間英語で独り言',
      ko: '🗣️ 2분간 영어로 말해보기',
      zh: '🗣️ 2分钟大声开口说',
      ru: '🗣️ Говорить вслух 2 мин',
      ar: '🗣️ التحدث بصوت عالٍ لدقيقتين',
      tr: '🗣️ 2 dk sesli konuş',
    },
    tag: {
      pt: '2 min • Fluência',
      en: '2 min • Fluency',
      es: '2 min • Fluidez',
      fr: '2 min • Fluidité',
      de: '2 Min • Flüssigkeit',
      it: '2 min • Fluenza',
      ja: '2分 • スピーキング',
      ko: '2분 • 스피킹 연습',
      zh: '2分钟 • 口语流利度',
      ru: '2 мин • Беглость речи',
      ar: 'دقيقتان • طلاقة',
      tr: '2 dk • Akıcılık',
    },
    color: 'text-purple-700',
    bgColor: 'bg-purple-50 border-purple-200',
  },
  {
    id: 'evening',
    icon: Film,
    timeOfDay: {
      pt: '20:30 - Noite',
      en: '08:30 PM - Evening',
      es: '20:30 - Noche',
      fr: '20:30 - Soirée',
      de: '20:30 - Abend',
      it: '20:30 - Sera',
      ja: '20:30 - 夜',
      ko: '20:30 - 저녁',
      zh: '20:30 - 晚上',
      ru: '20:30 - Вечер',
      ar: '20:30 - المساء',
      tr: '20:30 - Akşam',
    },
    title: {
      pt: 'Your Relaxing English Moment 📺',
      en: 'Your Relaxing English Moment 📺',
      es: 'Your Relaxing English Moment 📺',
      fr: 'Your Relaxing English Moment 📺',
      de: 'Your Relaxing English Moment 📺',
      it: 'Your Relaxing English Moment 📺',
      ja: 'Your Relaxing English Moment 📺',
      ko: 'Your Relaxing English Moment 📺',
      zh: 'Your Relaxing English Moment 📺',
      ru: 'Your Relaxing English Moment 📺',
      ar: 'Your Relaxing English Moment 📺',
      tr: 'Your Relaxing English Moment 📺',
    },
    desc: {
      pt: 'Assista 10 minutos da sua série favorita com áudio e legenda em inglês.',
      en: 'Watch 10 minutes of a show you truly enjoy in English with English subtitles.',
      es: 'Mira 10 minutos de tu serie favorita con audio y subtítulos en inglés.',
      fr: 'Regardez 10 minutes de votre série préférée en anglais avec sous-titres en anglais.',
      de: 'Schaue 10 Minuten deiner Lieblingsserie auf Englisch mit englischen Untertiteln.',
      it: 'Guarda 10 minuti della tua serie preferita con audio e sottotitoli in inglese.',
      ja: 'お気に入りの海外ドラマを英語音声・英語字幕で10分間楽しむ。',
      ko: '좋아하는 미드를 영어 오디오 및 영어 자막으로 10분간 감상해보세요.',
      zh: '开启英文字幕和英文原声，观看10分钟你最喜欢的剧集。',
      ru: 'Посмотрите 10 минут любимого сериала на английском с английскими субтитрами.',
      ar: 'شاهد 10 دقائق من مسلسلك المفضل باللغة الإنجليزية مع ترجمة إنجليزية.',
      tr: 'En sevdiğiniz diziyi İngilizce ses ve İngilizce altyazıyla 10 dakika izleyin.',
    },
    actionText: {
      pt: '🎬 10 min de série favorita',
      en: '🎬 10 min of favorite TV show',
      es: '🎬 10 min de serie favorita',
      fr: '🎬 10 min de votre série',
      de: '🎬 10 Min Lieblingsserie',
      it: '🎬 10 min serie preferita',
      ja: '🎬 お気に入り海外ドラマ10分',
      ko: '🎬 미드 10분 감상',
      zh: '🎬 10分钟英文剧集',
      ru: '🎬 10 мин любимого сериала',
      ar: '🎬 10 دقائق من مسلسلك المفضل',
      tr: '🎬 10 dk favori dizi',
    },
    tag: {
      pt: '10 min • Descontração',
      en: '10 min • Unwind',
      es: '10 min • Relax',
      fr: '10 min • Détente',
      de: '10 Min • Entspannung',
      it: '10 min • Relax',
      ja: '10分 • リラックス',
      ko: '10분 • 힐링',
      zh: '10分钟 • 放松',
      ru: '10 мин • Отдых',
      ar: '10 دقائق • استرخاء',
      tr: '10 dk • Dinlenme',
    },
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-50 border-indigo-200',
  },
  {
    id: 'journal',
    icon: Sparkles,
    timeOfDay: {
      pt: '22:00 - Encerramento',
      en: '10:00 PM - Wind Down',
      es: '22:00 - Cierre',
      fr: '22:00 - Bilan',
      de: '22:00 - Tagesabschluss',
      it: '22:00 - Chiusura',
      ja: '22:00 - まとめ',
      ko: '22:00 - 하루 마무리',
      zh: '22:00 - 晚间总结',
      ru: '22:00 - Итоги дня',
      ar: '22:00 - ختام اليوم',
      tr: '22:00 - Kapanış',
    },
    title: {
      pt: 'Your Daily Sentence with AI ✍️',
      en: 'Your Daily Sentence with AI ✍️',
      es: 'Your Daily Sentence with AI ✍️',
      fr: 'Your Daily Sentence with AI ✍️',
      de: 'Your Daily Sentence with AI ✍️',
      it: 'Your Daily Sentence with AI ✍️',
      ja: 'Your Daily Sentence with AI ✍️',
      ko: 'Your Daily Sentence with AI ✍️',
      zh: 'Your Daily Sentence with AI ✍️',
      ru: 'Your Daily Sentence with AI ✍️',
      ar: 'Your Daily Sentence with AI ✍️',
      tr: 'Your Daily Sentence with AI ✍️',
    },
    desc: {
      pt: 'Escreva 1 frase conectando as palavras do dia. Nossa IA dá feedback encorajador instantâneo.',
      en: 'Write just 1 sentence connecting your day’s words. Instant supportive feedback from Gemini AI.',
      es: 'Escribe 1 frase conectando las palabras del día. Nuestra IA ofrece feedback instantáneo.',
      fr: 'Écrivez 1 phrase reliant les mots du jour. Notre IA vous donne un retour instantané.',
      de: 'Schreibe 1 Satz mit deinen gelernten Wörtern. Sofortiges Feedback durch Gemini-KI.',
      it: 'Scrivi 1 frase collegando le parole del giorno. La nostra IA fornisce un feedback istantaneo.',
      ja: '今日の単語をつなげて1文作成。Gemini AIが優しく即座にフィードバック。',
      ko: '오늘의 단어를 연결하여 1문장을 작성해보세요. Gemini AI가 즉각 피드백을 제공합니다.',
      zh: '用今天的生词写下1个英文句子，Gemini AI即时提供鼓励式智能批改。',
      ru: 'Напишите 1 предложение с выученными словами. Gemini AI мгновенно даст обратную связь.',
      ar: 'اكتب جملة واحدة تربط بين كلمات اليوم. يمنحك الذكاء الاصطناعي تدقيقاً ودعماً فورياً.',
      tr: 'Günün kelimelerini birleştiren 1 cümle yazın. Gemini yapay zekası anında destekleyici geri bildirim verir.',
    },
    actionText: {
      pt: '✍️ 1 Frase do Dia com IA',
      en: '✍️ 1 Daily Sentence with AI',
      es: '✍️ 1 Frase del Día con IA',
      fr: '✍️ 1 Phrase du Jour avec IA',
      de: '✍️ 1 Satz des Tages mit KI',
      it: '✍️ 1 Frase del Giorno con IA',
      ja: '✍️ 1センテンス作成 (AI添削)',
      ko: '✍️ AI와 함께하는 오늘의 1문장',
      zh: '✍️ 每日1句 (AI智能批改)',
      ru: '✍️ 1 фраза дня с ИИ',
      ar: '✍️ جملة واحدة مع الذكاء الاصطناعي',
      tr: '✍️ Yapay Zeka ile Günün 1 Cümlesi',
    },
    tag: {
      pt: '2 min • Fixação',
      en: '2 min • Consolidation',
      es: '2 min • Consolidación',
      fr: '2 min • Ancrage',
      de: '2 Min • Festigung',
      it: '2 min • Consolidamento',
      ja: '2分 • 定着',
      ko: '2분 • 기억 정착',
      zh: '2分钟 • 记忆巩固',
      ru: '2 мин • Закрепление',
      ar: 'دقيقتان • ترسيخ',
      tr: '2 dk • Pekiştirme',
    },
    color: 'text-rose-700',
    bgColor: 'bg-rose-50 border-rose-200',
  },
];

export const EnglishMomentsShowcase: React.FC<EnglishMomentsShowcaseProps> = ({
  currentLanguage,
  onExploreRoutines,
  onFindTutors,
}) => {
  const [completedMoments, setCompletedMoments] = useState<string[]>(['morning', 'lunch']);
  const t = getTranslations(currentLanguage);

  const toggleMoment = (id: string) => {
    setCompletedMoments((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  return (
    <section className="py-16 sm:py-24 bg-[#000035] text-white border-t border-[#1C4C96]/50" id="english-moments">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1C4C96]/60 border border-[#9AB4FF]/50 text-[#9AB4FF] text-xs sm:text-sm font-bold">
            <Sparkles className="w-4 h-4 text-[#F4CA54]" />
            <span>{t.momentsHeaderBadge}</span>
          </div>

          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight">
            {t.momentsHeaderTitle}
          </h2>

          <p className="text-base sm:text-lg text-blue-100 font-normal leading-relaxed">
            {t.momentsHeaderSubtitle}
          </p>
        </div>

        {/* Live Interactive Counter Showcase */}
        <div className="mt-10 max-w-2xl mx-auto bg-gradient-to-r from-[#062863] to-[#1C4C96]/80 rounded-2xl p-4 sm:p-6 border border-[#607EC9]/50 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[#000035] text-white flex items-center justify-center font-black text-xl shadow-xs border border-[#9AB4FF]/40">
              <Flame className="w-6 h-6 text-[#F4CA54] fill-[#F4CA54]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-black text-white">
                  {completedMoments.length} {t.momentsTodayCount}
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-500/50">
                  {t.habitInAction}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-blue-100/90 font-medium">
                {t.momentsQuote}
              </p>
            </div>
          </div>

          <div className="text-center sm:text-right">
            <span className="text-xs text-[#9AB4FF]/80 font-bold block">
              {t.clickToSimulate}
            </span>
            <span className="text-xs font-bold text-[#F4CA54]">
              {completedMoments.length} / {MOMENTS.length} {t.completed}
            </span>
          </div>
        </div>

        {/* 6 Grid Cards */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {MOMENTS.map((m) => {
            const Icon = m.icon;
            const isCompleted = completedMoments.includes(m.id);
            const timeText = m.timeOfDay[currentLanguage] || m.timeOfDay.en;
            const titleText = m.title[currentLanguage] || m.title.en;
            const descText = m.desc[currentLanguage] || m.desc.en;
            const actionText = m.actionText[currentLanguage] || m.actionText.en;
            const tagText = m.tag[currentLanguage] || m.tag.en;

            return (
              <div
                key={m.id}
                onClick={() => toggleMoment(m.id)}
                className={`relative rounded-3xl p-6 border transition-all duration-200 cursor-pointer text-left flex flex-col justify-between ${
                  isCompleted
                    ? 'bg-gradient-to-br from-[#062863] to-[#1C4C96] border-[#9AB4FF] shadow-2xl ring-2 ring-[#9AB4FF]/50'
                    : 'bg-[#062863]/40 hover:bg-[#062863]/80 border-[#607EC9]/35 hover:border-[#607EC9] shadow-lg'
                }`}
              >
                <div>
                  {/* Top pill & time */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-bold font-mono px-2.5 py-1 rounded-md bg-[#000035] text-[#9AB4FF] border border-[#607EC9]/40">
                      {timeText}
                    </span>
                    <button
                      type="button"
                      className={`flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full transition ${
                        isCompleted
                          ? 'bg-emerald-900/90 text-emerald-200 border border-emerald-400'
                          : 'bg-[#000035]/80 text-slate-300 border border-[#607EC9]/30 hover:border-[#9AB4FF]'
                      }`}
                    >
                      <CheckCircle2 className={`w-3.5 h-3.5 ${isCompleted ? 'text-emerald-300' : 'text-slate-400'}`} />
                      <span>{isCompleted ? t.done : t.tapToDo}</span>
                    </button>
                  </div>

                  {/* Icon & Title */}
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#000035] border border-[#9AB4FF]/40 text-[#9AB4FF]">
                      <Icon className="w-5 h-5 text-[#9AB4FF]" />
                    </div>
                    <h3 className="font-extrabold text-white text-base sm:text-lg">
                      {titleText}
                    </h3>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-blue-100/90 leading-relaxed mt-2">
                    {descText}
                  </p>
                </div>

                {/* Bottom Action Feedback */}
                <div className="mt-6 pt-4 border-t border-[#1C4C96]/40 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">
                    {actionText}
                  </span>
                  <span className="font-bold text-[#9AB4FF] bg-[#000035] border border-[#607EC9]/40 px-2 py-0.5 rounded-md">
                    {tagText}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Call to Action */}
        <div className="mt-14 text-center">
          <div className="inline-flex flex-wrap items-center justify-center gap-4">
            {onExploreRoutines && (
              <button
                type="button"
                onClick={onExploreRoutines}
                className="px-7 py-3.5 rounded-2xl bg-[#607EC9] hover:bg-[#1C4C96] text-white font-bold text-sm sm:text-base shadow-xl transition flex items-center gap-2 cursor-pointer border border-[#9AB4FF]/60"
              >
                <span>{t.startLivingInEnglishDashboard}</span>
                <ArrowRight className="w-4 h-4 text-white" />
              </button>
            )}
            {onFindTutors && (
              <button
                type="button"
                onClick={onFindTutors}
                className="px-6 py-3.5 rounded-2xl bg-[#000035] text-white border border-[#607EC9] hover:bg-[#062863] font-bold text-sm sm:text-base shadow-lg transition cursor-pointer"
              >
                {t.heroFindFriendBtn}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

