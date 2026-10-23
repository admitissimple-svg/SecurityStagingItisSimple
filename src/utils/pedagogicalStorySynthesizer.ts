import { MatchingPair, FillInBlankItem, SentenceWritingPrompt, ReadingPassage, ReadingQuestion } from '../types';

export interface LexicalWordProfile {
  word: string;
  partOfSpeech: 'noun' | 'verb' | 'adjective' | 'adverb' | 'other';
  category: 'work' | 'people' | 'relation' | 'setting' | 'fitness' | 'weather' | 'time' | 'communication' | 'emotion' | 'general';
  translationPt: string;
  definitionEn: string;
  exampleSentenceEn: string;
}

/**
 * Comprehensive lexical dictionary covering modern workplace, communication,
 * daily routine, interpersonal relationships, wellness, and environmental vocabulary.
 */
export const COMPREHENSIVE_LEXICON: Record<string, Omit<LexicalWordProfile, 'word'>> = {
  // People, Roles & Pronouns
  nobody: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'ninguém',
    definitionEn: 'No person; not a single person in a group, room, or setting',
    exampleSentenceEn: 'Nobody was in the meeting room when I arrived early this morning.',
  },
  everyone: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'todos / todo mundo',
    definitionEn: 'Every person; all the members of a group, team, or audience',
    exampleSentenceEn: 'Everyone agreed on the new schedule during our weekly team meeting.',
  },
  anyone: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'qualquer pessoa / alguém / ninguém (em perguntas ou negativas)',
    definitionEn: 'Any person at all, especially used in questions and negative statements',
    exampleSentenceEn: 'Did anyone remember to share the updated notes after the team presentation?',
  },
  somebody: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'alguém',
    definitionEn: 'Some person; an unspecified or unknown individual',
    exampleSentenceEn: 'Somebody left an umbrella by the office entrance before the rain started.',
  },
  someone: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'alguém',
    definitionEn: 'An unspecified person; an individual in a group',
    exampleSentenceEn: 'Someone suggested organizing a brief coffee break to recharge during the afternoon.',
  },
  boss: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'chefe / gestor(a)',
    definitionEn: 'A person who is in charge of a worker or organization; a supervisor or manager',
    exampleSentenceEn: 'My boss provided clear guidance and encouragement during our weekly check-in.',
  },
  employee: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'funcionário(a) / colaborador(a)',
    definitionEn: 'A person employed for wages or salary, especially at non-executive level',
    exampleSentenceEn: 'Every employee contributes unique skills to the success of the department.',
  },
  manager: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'gerente / gestor(a)',
    definitionEn: 'A person responsible for controlling or administering an organization or group of staff',
    exampleSentenceEn: 'The project manager coordinated tasks across our international team.',
  },
  colleague: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'colega de trabalho',
    definitionEn: 'A person with whom one works in a profession or business',
    exampleSentenceEn: 'I collaborated with a knowledgeable colleague to prepare the proposal.',
  },
  leader: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'líder',
    definitionEn: 'The person who leads, guides, or inspires a group or organization',
    exampleSentenceEn: 'A great team leader listens actively and supports everyone\'s growth.',
  },
  client: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'cliente',
    definitionEn: 'A person or organization using the services of a professional person or company',
    exampleSentenceEn: 'We scheduled a video call to discuss the project deliverables with our client.',
  },
  customer: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'cliente / consumidor',
    definitionEn: 'A person or company that buys goods or services from a store or business',
    exampleSentenceEn: 'Providing exceptional customer service builds lasting loyalty.',
  },
  team: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'equipe / time',
    definitionEn: 'A group of people working together to achieve a common goal',
    exampleSentenceEn: 'Our cross-functional team delivered outstanding results this quarter.',
  },
  friend: {
    partOfSpeech: 'noun',
    category: 'people',
    translationPt: 'amigo(a)',
    definitionEn: 'A person whom one knows and with whom one has a bond of mutual affection',
    exampleSentenceEn: 'I had lunch with a close friend to catch up on our weekly news.',
  },

  // Relations & Interactions
  relationship: {
    partOfSpeech: 'noun',
    category: 'relation',
    translationPt: 'relacionamento / relação',
    definitionEn: 'The way in which two or more people, groups, or concepts are connected or interact',
    exampleSentenceEn: 'Building a strong working relationship with colleagues fosters trust and collaboration.',
  },
  environment: {
    partOfSpeech: 'noun',
    category: 'setting',
    translationPt: 'ambiente / meio ambiente',
    definitionEn: 'The surroundings or conditions in which a person, animal, or plant lives or operates',
    exampleSentenceEn: 'Creating a positive work environment boosts motivation and daily well-being.',
  },
  workplace: {
    partOfSpeech: 'noun',
    category: 'setting',
    translationPt: 'local de trabalho',
    definitionEn: 'A place where people work, such as an office, factory, or store',
    exampleSentenceEn: 'A modern workplace values open communication, flexibility, and mutual respect.',
  },
  culture: {
    partOfSpeech: 'noun',
    category: 'setting',
    translationPt: 'cultura (organizacional)',
    definitionEn: 'The attitudes, values, and practices shared by members of an organization',
    exampleSentenceEn: 'A healthy company culture encourages continuous learning and constructive feedback.',
  },
  office: {
    partOfSpeech: 'noun',
    category: 'setting',
    translationPt: 'escritório',
    definitionEn: 'A room, set of rooms, or building used as a place for commercial or professional work',
    exampleSentenceEn: 'I arrived at the office early to prepare my presentation in a quiet atmosphere.',
  },

  // Time & Frequency
  now: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'agora / neste momento',
    definitionEn: 'At the present time or moment; immediately without delay',
    exampleSentenceEn: 'I need to review our project notes right now before the meeting starts.',
  },
  nowadays: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'hoje em dia / atualmente',
    definitionEn: 'At the present time, in comparison with the past',
    exampleSentenceEn: 'Nowadays, many organizations prioritize employee well-being and flexible schedules.',
  },
  today: {
    partOfSpeech: 'noun',
    category: 'time',
    translationPt: 'hoje',
    definitionEn: 'On or in the course of the present day',
    exampleSentenceEn: 'Our main priority today is to finalize the client review on time.',
  },
  tomorrow: {
    partOfSpeech: 'noun',
    category: 'time',
    translationPt: 'amanhã',
    definitionEn: 'On or for the day following today',
    exampleSentenceEn: 'We scheduled the strategic planning session for tomorrow morning.',
  },
  yesterday: {
    partOfSpeech: 'noun',
    category: 'time',
    translationPt: 'ontem',
    definitionEn: 'On the day before today',
    exampleSentenceEn: 'Yesterday we had an insightful conversation with our native friend.',
  },
  moment: {
    partOfSpeech: 'noun',
    category: 'time',
    translationPt: 'momento',
    definitionEn: 'A very brief period of time; an exact or significant point in time',
    exampleSentenceEn: 'Taking a quiet moment to reflect before starting a new task clears the mind.',
  },
  schedule: {
    partOfSpeech: 'noun',
    category: 'time',
    translationPt: 'cronograma / agenda',
    definitionEn: 'A plan for carrying out a process or procedure, giving lists of intended events and times',
    exampleSentenceEn: 'I always review my daily schedule over morning coffee to organize my tasks.',
  },
  routine: {
    partOfSpeech: 'noun',
    category: 'time',
    translationPt: 'rotina',
    definitionEn: 'A sequence of actions regularly followed; a fixed program',
    exampleSentenceEn: 'Establishing a steady morning routine brings calm and consistency to the day.',
  },
  break: {
    partOfSpeech: 'noun',
    category: 'time',
    translationPt: 'pausa / intervalo',
    definitionEn: 'A pause in work or during an activity or event',
    exampleSentenceEn: 'Stepping away for a 10-minute break helps restore mental focus.',
  },
  already: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'já',
    definitionEn: 'Before or by now or the time in question',
    exampleSentenceEn: 'By 10:00 AM, our team had already finalized the weekly performance report.',
  },
  soon: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'em breve / logo',
    definitionEn: 'In or after a short time; without long delay',
    exampleSentenceEn: 'We will soon schedule our next live practice session with our native friend.',
  },
  early: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'cedo / adiantado',
    definitionEn: 'Happening or done before the usual or expected time',
    exampleSentenceEn: 'Waking up early gives me quiet time to read and plan my daily schedule.',
  },
  late: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'tarde / atrasado',
    definitionEn: 'Doing something or taking place after the expected or proper time',
    exampleSentenceEn: 'We worked late on Tuesday to ensure the deliverables met our high quality standards.',
  },
  always: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'sempre',
    definitionEn: 'At all times; on all occasions',
    exampleSentenceEn: 'I always review my vocabulary notes over breakfast before opening my work inbox.',
  },
  never: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'nunca',
    definitionEn: 'At no time in the past or future; on no occasion',
    exampleSentenceEn: 'He never misses his morning English audio session, even when traveling.',
  },
  often: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'frequentemente',
    definitionEn: 'Many times; at frequent intervals',
    exampleSentenceEn: 'We often collaborate across international time zones to finalize major client projects.',
  },
  sometimes: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'às vezes',
    definitionEn: 'At certain times; occasionally',
    exampleSentenceEn: 'Sometimes a five-minute break away from your screen is the best way to regain focus.',
  },
  rarely: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'raramente',
    definitionEn: 'Not often; seldom',
    exampleSentenceEn: 'She rarely encounters communication problems now that she practices with native friends.',
  },

  // Work, Business & Tasks
  job: {
    partOfSpeech: 'noun',
    category: 'work',
    translationPt: 'trabalho / emprego / função',
    definitionEn: 'A paid position of regular employment or specific task to be done',
    exampleSentenceEn: 'Having clear responsibilities at my job makes daily teamwork much smoother.',
  },
  work: {
    partOfSpeech: 'noun',
    category: 'work',
    translationPt: 'trabalho / trabalhar',
    definitionEn: 'Activity involving mental or physical effort done in order to achieve a purpose or result',
    exampleSentenceEn: 'Organizing my desk helps me dive straight into focused work every morning.',
  },
  project: {
    partOfSpeech: 'noun',
    category: 'work',
    translationPt: 'projeto',
    definitionEn: 'An individual or collaborative enterprise planned to achieve a particular aim',
    exampleSentenceEn: 'Our cross-functional team delivered the quarterly project ahead of schedule.',
  },
  task: {
    partOfSpeech: 'noun',
    category: 'work',
    translationPt: 'tarefa',
    definitionEn: 'A piece of work to be done or undertaken',
    exampleSentenceEn: 'Breaking a complex task into smaller steps makes it much easier to execute.',
  },
  deadline: {
    partOfSpeech: 'noun',
    category: 'work',
    translationPt: 'prazo final',
    definitionEn: 'The latest time or date by which something should be completed',
    exampleSentenceEn: 'Meeting Friday\'s deadline required careful coordination and steady focus.',
  },
  meeting: {
    partOfSpeech: 'noun',
    category: 'work',
    translationPt: 'reunião',
    definitionEn: 'An assembly of people for discussion or all kinds of business interactions',
    exampleSentenceEn: 'We held a productive 20-minute meeting to align on project deliverables.',
  },
  priority: {
    partOfSpeech: 'noun',
    category: 'work',
    translationPt: 'prioridade',
    definitionEn: 'A thing that is regarded as more important than another',
    exampleSentenceEn: 'Setting my top priority first thing in the morning keeps my day organized.',
  },
  feedback: {
    partOfSpeech: 'noun',
    category: 'communication',
    translationPt: 'feedback / retorno',
    definitionEn: 'Information about reactions to a product or a person\'s performance of a task',
    exampleSentenceEn: 'Constructive feedback from mentors accelerates professional growth.',
  },
  conversation: {
    partOfSpeech: 'noun',
    category: 'communication',
    translationPt: 'conversa / diálogo',
    definitionEn: 'A talk, especially an informal one, between two or more people',
    exampleSentenceEn: 'Having an authentic conversation with native speakers accelerates fluency.',
  },
  practice: {
    partOfSpeech: 'noun',
    category: 'communication',
    translationPt: 'prática / praticar',
    definitionEn: 'Repeated exercise in or performance of an activity so as to acquire or maintain proficiency',
    exampleSentenceEn: 'Consistent daily practice is the true secret to effortless speaking fluency.',
  },
  email: {
    partOfSpeech: 'noun',
    category: 'communication',
    translationPt: 'e-mail / mensagem',
    definitionEn: 'Messages distributed by electronic means from one computer user to one or more recipients',
    exampleSentenceEn: 'I sent a concise email summarizing the key action items for the client.',
  },
  call: {
    partOfSpeech: 'noun',
    category: 'communication',
    translationPt: 'chamada / ligação',
    definitionEn: 'A telephone or video conversation between people',
    exampleSentenceEn: 'We resolved the pending question during a quick 10-minute video call.',
  },

  // Wellness, Health & Fitness
  workout: {
    partOfSpeech: 'noun',
    category: 'fitness',
    translationPt: 'treino / exercício',
    definitionEn: 'A structured session of physical exercise or training',
    exampleSentenceEn: 'Completing a 30-minute workout in the morning energizes my entire day.',
  },
  exercise: {
    partOfSpeech: 'noun',
    category: 'fitness',
    translationPt: 'exercício / praticar',
    definitionEn: 'Activity requiring physical effort to sustain or improve health and fitness',
    exampleSentenceEn: 'Regular physical exercise helps reduce workplace stress and enhances focus.',
  },
  run: {
    partOfSpeech: 'noun',
    category: 'fitness',
    translationPt: 'corrida / correr',
    definitionEn: 'An act or spell of running, often for fitness or recreation',
    exampleSentenceEn: 'I went for a brisk run around the neighborhood park before breakfast.',
  },
  walk: {
    partOfSpeech: 'noun',
    category: 'fitness',
    translationPt: 'caminhada / caminhar',
    definitionEn: 'A journey made on foot, especially for pleasure or exercise',
    exampleSentenceEn: 'Taking a short walk during lunch helps me reset between meetings.',
  },
  health: {
    partOfSpeech: 'noun',
    category: 'fitness',
    translationPt: 'saúde',
    definitionEn: 'The state of being free from illness or injury; overall physical and mental well-being',
    exampleSentenceEn: 'Prioritizing mental and physical health is essential for sustainable progress.',
  },
  coffee: {
    partOfSpeech: 'noun',
    category: 'general',
    translationPt: 'café',
    definitionEn: 'A hot drink made from the roasted and ground bean-like seeds of a tropical shrub',
    exampleSentenceEn: 'A freshly brewed cup of black coffee helps me start the morning with focus.',
  },
  breakfast: {
    partOfSpeech: 'noun',
    category: 'general',
    translationPt: 'café da manhã',
    definitionEn: 'A meal eaten in the morning, the first of the day',
    exampleSentenceEn: 'Eating a balanced breakfast provides steady stamina for the morning.',
  },

  // Weather & Atmosphere
  weather: {
    partOfSpeech: 'noun',
    category: 'weather',
    translationPt: 'clima / tempo',
    definitionEn: 'The state of the atmosphere in terms of temperature, wind, and rain',
    exampleSentenceEn: 'I always check the daily weather before planning outdoor activities.',
  },
  storm: {
    partOfSpeech: 'noun',
    category: 'weather',
    translationPt: 'tempestade',
    definitionEn: 'An intense weather event with strong winds, rain, or thunder',
    exampleSentenceEn: 'A sudden storm forced us to stay indoors during the afternoon.',
  },
  rain: {
    partOfSpeech: 'noun',
    category: 'weather',
    translationPt: 'chuva',
    definitionEn: 'Moisture condensed from the atmosphere that falls in drops',
    exampleSentenceEn: 'The heavy rain made the morning commute a bit slower than usual.',
  },
  sun: {
    partOfSpeech: 'noun',
    category: 'weather',
    translationPt: 'sol',
    definitionEn: 'The star around which the earth orbits, bringing natural light and warmth',
    exampleSentenceEn: 'Stepping outside into the warm morning sun gave me fresh energy.',
  },

  // Emotion, Mindset & Focus
  focus: {
    partOfSpeech: 'noun',
    category: 'emotion',
    translationPt: 'foco / concentração',
    definitionEn: 'The center of interest or activity; state of concentrated attention',
    exampleSentenceEn: 'Eliminating notifications allowed me to maintain deep focus for two hours.',
  },
  confidence: {
    partOfSpeech: 'noun',
    category: 'emotion',
    translationPt: 'confiança',
    definitionEn: 'A feeling of self-assurance arising from one\'s appreciation of one\'s own abilities',
    exampleSentenceEn: 'Speaking English every day builds natural confidence in any professional setting.',
  },
  balance: {
    partOfSpeech: 'noun',
    category: 'emotion',
    translationPt: 'equilíbrio',
    definitionEn: 'A situation in which different elements are equal or in the correct proportions',
    exampleSentenceEn: 'Creating healthy boundaries fosters a rewarding work-life balance.',
  },
  progress: {
    partOfSpeech: 'noun',
    category: 'emotion',
    translationPt: 'progresso / avançar',
    definitionEn: 'Forward or onward movement toward a destination or goal',
    exampleSentenceEn: 'Tracking daily accomplishments highlights the steady progress you make each week.',
  },

  // Descriptive & Idiomatic Vocabulary
  awesome: {
    partOfSpeech: 'adjective',
    category: 'emotion',
    translationPt: 'incrível / maravilhoso / sensacional',
    definitionEn: 'Extremely impressive, enjoyable, or very good',
    exampleSentenceEn: 'The team did an awesome job delivering the final project ahead of the deadline.',
  },
  'spot on': {
    partOfSpeech: 'adjective',
    category: 'general',
    translationPt: 'certeiro / exato / na mosca',
    definitionEn: 'Completely accurate, correct, or precisely right',
    exampleSentenceEn: 'Her analysis of the project challenges was completely spot on.',
  },
  'spot-on': {
    partOfSpeech: 'adjective',
    category: 'general',
    translationPt: 'certeiro / exato / na mosca',
    definitionEn: 'Completely accurate, correct, or precisely right',
    exampleSentenceEn: 'His timing for the presentation was spot-on and impressed everyone.',
  },

  // Core Common Vocabulary & Action Terms
  app: {
    partOfSpeech: 'noun',
    category: 'work',
    translationPt: 'aplicativo / app',
    definitionEn: 'A software program designed to perform a specific function directly for the user on a mobile device or computer',
    exampleSentenceEn: 'I opened the mobile app on my smartphone to practice English during my morning commute.',
  },
  happy: {
    partOfSpeech: 'adjective',
    category: 'emotion',
    translationPt: 'feliz / contente / satisfeito',
    definitionEn: 'Feeling or showing pleasure, satisfaction, or contentment with life or work',
    exampleSentenceEn: 'The client was very happy with the prompt delivery and high quality of our project.',
  },
  perfect: {
    partOfSpeech: 'adjective',
    category: 'general',
    translationPt: 'perfeito / ideal',
    definitionEn: 'Having all desirable elements, qualities, or characteristics; completely suitable or ideal',
    exampleSentenceEn: 'A quiet morning at home provides the perfect environment for focused study and deep concentration.',
  },
  simple: {
    partOfSpeech: 'adjective',
    category: 'general',
    translationPt: 'simples / descomplicado',
    definitionEn: 'Easily understood or done; presenting no unnecessary complication or difficulty',
    exampleSentenceEn: 'Our method makes learning English simple, natural, and directly connected to daily life.',
  },
  easy: {
    partOfSpeech: 'adjective',
    category: 'general',
    translationPt: 'fácil / tranquilo',
    definitionEn: 'Achieved without great effort; presenting few difficulties',
    exampleSentenceEn: 'With consistent daily practice, remembering practical vocabulary becomes remarkably easy.',
  },
  important: {
    partOfSpeech: 'adjective',
    category: 'general',
    translationPt: 'importante / essencial',
    definitionEn: 'Of great significance or value; likely to have a profound effect on success',
    exampleSentenceEn: 'It is important to review new expressions immediately following your conversation with a native friend.',
  },
  clear: {
    partOfSpeech: 'adjective',
    category: 'communication',
    translationPt: 'claro / objetivo',
    definitionEn: 'Easy to perceive, understand, or interpret; transparent in communication',
    exampleSentenceEn: 'She gave a very clear explanation of the project milestones during our team meeting.',
  },
  productive: {
    partOfSpeech: 'adjective',
    category: 'work',
    translationPt: 'produtivo',
    definitionEn: 'Achieving or producing a significant amount or excellent result',
    exampleSentenceEn: 'We had a highly productive morning session aligning on all client deliverables.',
  },
  calm: {
    partOfSpeech: 'adjective',
    category: 'emotion',
    translationPt: 'calmo / tranquilo',
    definitionEn: 'Not showing or feeling nervousness, agitation, or stress; peaceful',
    exampleSentenceEn: 'Remaining calm under pressure helped her negotiate the agreement with great poise.',
  },
  confident: {
    partOfSpeech: 'adjective',
    category: 'emotion',
    translationPt: 'confiante / seguro',
    definitionEn: 'Feeling or showing certainty about one\'s abilities or qualities',
    exampleSentenceEn: 'Practicing daily conversation with native tutors makes students truly confident when speaking.',
  },
  ready: {
    partOfSpeech: 'adjective',
    category: 'general',
    translationPt: 'pronto / preparado',
    definitionEn: 'In a suitable state for an activity, action, or situation; fully prepared',
    exampleSentenceEn: 'After preparing the slide deck, the entire team was ready for the executive briefing.',
  },
  busy: {
    partOfSpeech: 'adjective',
    category: 'general',
    translationPt: 'ocupado / movimentado',
    definitionEn: 'Having a great deal to do; keeping active with tasks and responsibilities',
    exampleSentenceEn: 'Despite having a busy weekday schedule, she always reserves twenty minutes for English practice.',
  },
  start: {
    partOfSpeech: 'verb',
    category: 'general',
    translationPt: 'começar / iniciar',
    definitionEn: 'To begin doing or taking part in an activity or journey',
    exampleSentenceEn: 'I start my daily routine early in the morning with a warm cup of coffee and light reading.',
  },
  finish: {
    partOfSpeech: 'verb',
    category: 'general',
    translationPt: 'terminar / concluir',
    definitionEn: 'To bring a task, project, or activity to a complete end',
    exampleSentenceEn: 'Our priority today is to finish the client proposal before the end of the afternoon.',
  },
  learn: {
    partOfSpeech: 'verb',
    category: 'general',
    translationPt: 'aprender',
    definitionEn: 'To acquire knowledge or skill through study, experience, or being taught',
    exampleSentenceEn: 'You learn English much faster by living your daily routine than by memorizing abstract rules.',
  },
  speak: {
    partOfSpeech: 'verb',
    category: 'communication',
    translationPt: 'falar / conversar',
    definitionEn: 'To say words orally; to communicate using spoken language',
    exampleSentenceEn: 'The best way to speak English naturally is having regular conversations with native friends.',
  },
  listen: {
    partOfSpeech: 'verb',
    category: 'communication',
    translationPt: 'ouvir / escutar com atenção',
    definitionEn: 'To give one\'s attention to a sound or speaker in order to understand',
    exampleSentenceEn: 'I listen to English podcasts while taking a brisk walk in the morning.',
  },
  read: {
    partOfSpeech: 'verb',
    category: 'general',
    translationPt: 'ler',
    definitionEn: 'To look at and comprehend the meaning of written words and sentences',
    exampleSentenceEn: 'I read the international industry report to prepare for the upcoming client call.',
  },
  write: {
    partOfSpeech: 'verb',
    category: 'general',
    translationPt: 'escrever',
    definitionEn: 'To compose text or record thoughts and information in written form',
    exampleSentenceEn: 'Writing in my daily reflection journal locks in the new vocabulary I acquired today.',
  },
  review: {
    partOfSpeech: 'verb',
    category: 'work',
    translationPt: 'revisar / examinar',
    definitionEn: 'To examine or assess something again with the possibility of instituting change',
    exampleSentenceEn: 'Let us review the presentation slides together to ensure every point is accurate.',
  },
  this: {
    partOfSpeech: 'other',
    category: 'general',
    translationPt: 'este / esta / isto',
    definitionEn: 'Used to identify a specific person, object, or situation close at hand or currently being discussed',
    exampleSentenceEn: 'We need to review this proposal carefully before submitting it to the executive board.',
  },
  that: {
    partOfSpeech: 'other',
    category: 'general',
    translationPt: 'aquele / aquela / aquilo',
    definitionEn: 'Used to refer to a specific person, thing, or event previously mentioned or further away',
    exampleSentenceEn: 'I hope that meeting provides the answers we have been waiting for.',
  },
  is: {
    partOfSpeech: 'verb',
    category: 'general',
    translationPt: 'é / está',
    definitionEn: 'Third-person singular present of "be", expressing current existence, state, or fundamental identity',
    exampleSentenceEn: 'Clear communication is the essential foundation for effective teamwork across departments.',
  },
  are: {
    partOfSpeech: 'verb',
    category: 'general',
    translationPt: 'são / estão',
    definitionEn: 'Present tense plural form of "be", expressing the state or condition of multiple people or things',
    exampleSentenceEn: 'Consistent daily routines are powerful tools for building long-term fluency and confidence.',
  },
  just: {
    partOfSpeech: 'adverb',
    category: 'time',
    translationPt: 'acabar de / apenas / exatamente',
    definitionEn: 'Used to indicate that an event happened only a moment ago, or to convey precision and simplicity',
    exampleSentenceEn: 'She has just finalized the project schedule and shared it with the entire department.',
  },
  new: {
    partOfSpeech: 'adjective',
    category: 'general',
    translationPt: 'novo / recém-chegado / inovador',
    definitionEn: 'Recently produced, introduced, discovered, or experienced for the first time in your routine',
    exampleSentenceEn: 'Our team adopted a new software system that drastically reduces manual data entry.',
  },
  test: {
    partOfSpeech: 'noun',
    category: 'work',
    translationPt: 'teste / avaliar / verificação',
    definitionEn: 'A procedure or trial designed to evaluate the performance, reliability, or quality of a system or idea',
    exampleSentenceEn: 'The engineers conducted a rigorous performance test before approving the product launch.',
  },
  plan: {
    partOfSpeech: 'noun',
    category: 'work',
    translationPt: 'plano / planejar',
    definitionEn: 'A detailed proposal for doing or achieving something through organized steps',
    exampleSentenceEn: 'Creating a realistic weekly plan keeps your daily workload structured and manageable.',
  },
  goal: {
    partOfSpeech: 'noun',
    category: 'work',
    translationPt: 'meta / objetivo',
    definitionEn: 'An aim or desired result that a person or group envisions and commits to achieve',
    exampleSentenceEn: 'Speaking English effortlessly with international colleagues is my primary professional goal.',
  },
  habit: {
    partOfSpeech: 'noun',
    category: 'general',
    translationPt: 'hábito / prática diária',
    definitionEn: 'A settled or regular tendency or practice, especially one that is hard to give up or routine',
    exampleSentenceEn: 'Listening to an English podcast during breakfast has become an effortless daily habit.',
  },
};

/**
 * Clean any boilerplate or generic text from incoming definitions or sentences
 */
function isGenericText(text?: string): boolean {
  if (!text || typeof text !== 'string') return true;
  const lower = text.toLowerCase();
  return (
    lower.includes('core active vocabulary applied') ||
    lower.includes('active vocabulary practiced during') ||
    lower.includes('i practice using') ||
    lower.includes('key vocabulary term practiced') ||
    lower.includes('applied during your daily') ||
    lower.includes('understanding how to optimize') ||
    lower.includes('the team established a') ||
    lower.includes('key concept representing') ||
    lower.includes('descriptive term characterizing') ||
    lower.includes('action term describing') ||
    lower.includes('modifying term highlighting') ||
    lower.includes('with clear intention creates noticeable progress') ||
    lower.includes('focus on the sentence context to identify') ||
    lower.includes('practicing with') ||
    lower.includes('builds natural fluency and confidence') ||
    lower.includes('plays an indispensable role in maintaining team morale') ||
    lower.includes('having a clear and structured')
  );
}

/**
 * Resolves or dynamically profiles any English word into a rich lexical profile.
 */
export function profileWord(
  rawWord: string,
  providedDetails?: {
    definitionEn?: string;
    translationPt?: string;
    exampleSentence?: string;
  }
): LexicalWordProfile {
  const clean = rawWord.trim();
  const lower = clean.toLowerCase();

  // 1. Exact match in comprehensive lexicon
  if (COMPREHENSIVE_LEXICON[lower]) {
    const lex = COMPREHENSIVE_LEXICON[lower];
    const userDef = providedDetails?.definitionEn && !isGenericText(providedDetails.definitionEn)
      ? providedDetails.definitionEn
      : lex.definitionEn;
    const userEx = providedDetails?.exampleSentence && !isGenericText(providedDetails.exampleSentence) && providedDetails.exampleSentence.toLowerCase().includes(lower)
      ? providedDetails.exampleSentence
      : lex.exampleSentenceEn;
    return {
      word: clean,
      partOfSpeech: lex.partOfSpeech,
      category: lex.category,
      translationPt: providedDetails?.translationPt || lex.translationPt,
      definitionEn: userDef,
      exampleSentenceEn: userEx,
    };
  }

  // 2. Intelligent morphological profiling
  let partOfSpeech: LexicalWordProfile['partOfSpeech'] = 'noun';
  let category: LexicalWordProfile['category'] = 'general';

  if (/ing$/i.test(clean)) partOfSpeech = 'verb';
  else if (/ly$/i.test(clean)) partOfSpeech = 'adverb';
  else if (/(ful|less|able|ible|ous|ive|ic|al|y)$/i.test(clean)) partOfSpeech = 'adjective';
  else if (/(ize|ise|ate|en|ify|ed)$/i.test(clean)) partOfSpeech = 'verb';

  if (/er$|or$|ee$|ist$|ian$/i.test(clean)) category = 'people';
  else if (/tion$|sion$|ment$|ness$|ship$/i.test(clean)) category = 'relation';

  // Authentic contextual definitions and real-world example sentences - ZERO generic boilerplate!
  let defaultDef = '';
  let defaultEx = '';

  if (providedDetails?.definitionEn && !isGenericText(providedDetails.definitionEn)) {
    defaultDef = providedDetails.definitionEn;
  } else {
    switch (partOfSpeech) {
      case 'verb':
        defaultDef = `To engage in, conduct, or carry out the action of ${clean} in personal or workplace situations.`;
        defaultEx = `During our daily routine, our team collaborates closely to ${clean} effectively.`;
        break;
      case 'adjective':
        defaultDef = `Characterized by being ${clean}; expressing a notable quality, state, or condition.`;
        defaultEx = `Maintaining a ${clean} mindset makes daily communication and collaborative projects much smoother.`;
        break;
      case 'adverb':
        defaultDef = `In a distinct manner, degree, or timing characterized as ${clean}.`;
        defaultEx = `She expressed her perspective ${clean}, ensuring that every participant understood the message.`;
        break;
      default:
        defaultDef = `An important concept, role, or term referring to ${clean} in everyday life and communication.`;
        defaultEx = `Our team focused on the importance of ${clean} during the planning session.`;
    }
  }

  if (providedDetails?.exampleSentence && !isGenericText(providedDetails.exampleSentence) && providedDetails.exampleSentence.toLowerCase().includes(lower)) {
    defaultEx = providedDetails.exampleSentence;
  } else if (!defaultEx || isGenericText(defaultEx)) {
    if (lower === 'nobody') {
      defaultEx = 'Nobody was in the meeting room when I arrived early this morning.';
    } else if (lower === 'everyone') {
      defaultEx = 'Everyone agreed on the new schedule during our weekly team meeting.';
    } else if (lower === 'anyone') {
      defaultEx = 'Did anyone remember to share the updated notes after the team presentation?';
    } else if (lower === 'somebody' || lower === 'someone') {
      defaultEx = 'Someone suggested organizing a brief coffee break to recharge during the afternoon.';
    } else if (lower === 'awesome') {
      defaultEx = 'The team did an awesome job delivering the final project ahead of the deadline.';
    } else if (lower === 'spot on' || lower === 'spot-on') {
      defaultEx = 'Her analysis of the project challenges was completely spot on.';
    } else if (partOfSpeech === 'verb') {
      defaultEx = `We coordinated our schedule to ${clean} the deliverables on time.`;
    } else if (partOfSpeech === 'adjective') {
      defaultEx = `The presentation received ${clean} feedback from our partners.`;
    } else {
      defaultEx = `Understanding how ${clean} applies in practice helps make communication clearer.`;
    }
  }

  const defaultTrans = providedDetails?.translationPt || clean;

  return {
    word: clean,
    partOfSpeech,
    category,
    translationPt: defaultTrans,
    definitionEn: defaultDef,
    exampleSentenceEn: defaultEx,
  };
}

/**
 * Detection for stale, formulaic, or robotic story templates that should never be shown to students.
 */
export function isBadStoryText(text?: string | null): boolean {
  if (!text || typeof text !== 'string' || text.trim().length < 120) return true;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 25);
  if (paragraphs.length < 4) return true;

  const t = text.toLowerCase();
  return (
    t.includes('the day began with great purpose as') ||
    t.includes('the working session began with clear intention as') ||
    t.includes('the project breakthrough') ||
    t.includes('reviewed key plans regarding') ||
    t.includes('address **') ||
    t.includes('managing **') ||
    t.includes('progress made on **') ||
    t.includes('to make sure everything stayed aligned') ||
    t.includes('quick to ') ||
    t.includes('refreshing weather') ||
    t.includes('storm terms') ||
    t.includes('a productive day of focus and growth') ||
    t.includes('finishing the workday on schedule allowed everyone to celebrate') ||
    t.includes('collaborating closely with colleagues to') ||
    t.includes('before wrapping up the day, celebrating the successful delivery of') ||
    t.includes('delivery of the small') ||
    t.includes('to need every detail') ||
    t.includes('in the youtube video') ||
    t.includes('the video showed') ||
    t.includes('as seen in the video clip') ||
    t.includes('watched the video')
  );
}

/**
 * Generates a natural, cohesive narrative (Part 4)
 * connecting target words into a realistic scenario without robotic templates.
 */
export function synthesizeCohesiveStoryAndQuestions(params: {
  words: string[];
  studentLevel?: string;
  studentName?: string;
  wordDetails?: Array<{
    word: string;
    definitionEn?: string;
    translationPt?: string;
    exampleSentence?: string;
  }>;
}): {
  title: string;
  text: string;
  questions: ReadingQuestion[];
} {
  const { words, studentLevel = 'Intermediate', studentName = 'Student', wordDetails = [] } = params;

  const profiles: LexicalWordProfile[] = words.map((w) => {
    const detail = wordDetails.find((d) => d.word.toLowerCase().trim() === w.toLowerCase().trim());
    return profileWord(w, detail);
  });

  if (profiles.length === 0) {
    return {
      title: 'Awaiting Weekly Vocabulary',
      text: 'Add new vocabulary to your daily routine to generate your personalized story and comprehension activity.',
      questions: [],
    };
  }

  const level = studentLevel.toLowerCase();
  const isAdv = level.includes('avan') || level.includes('advan');
  const isInter = level.includes('inter');
  const levelLabel = isAdv ? 'Advanced' : isInter ? 'Intermediate' : 'Beginner';

  const protagonist = studentName && studentName !== 'Student' && studentName !== 'Aluno' ? studentName.split(' ')[0] : 'The student';

  // Specific semantic matching for cohesive workplace / daily scenario
  const wordMap = new Map<string, LexicalWordProfile>();
  profiles.forEach((p) => wordMap.set(p.word.toLowerCase(), p));

  const has = (key: string) => wordMap.get(key.toLowerCase());

  // Check special thematic clusters
  const nowadays = has('nowadays');
  const relationship = has('relationship');
  const boss = has('boss');
  const employee = has('employee');
  const environment = has('environment');
  const weather = has('weather');
  const storm = has('storm');
  const workout = has('workout');
  const job = has('job');
  const moment = has('moment');

  let title = `A Productive Day in the Life (${levelLabel})`;
  let p1 = '';
  let p2 = '';
  let p3 = '';
  let p4 = '';

  const questions: ReadingQuestion[] = [];

  // SCENARIO 1: The Modern Workplace & Leadership (Student's specific scenario: nowadays, relationship, boss, employee, environment)
  if (nowadays && environment && (boss || employee || relationship)) {
    title = `Leadership and Culture in the Modern Workplace (${levelLabel})`;

    p1 = `**Nowadays**, creating a positive work **environment** has become a top priority for forward-thinking organizations. Leaders understand that a healthy atmosphere directly influences motivation, creativity, and daily focus.`;

    if (boss && employee && relationship) {
      p2 = `At the office, ${protagonist} observed how essential a respectful **relationship** is between a supportive **boss** and every dedicated **employee**. When managers listen actively and staff members feel valued, team collaboration becomes natural and effortless.`;
    } else if (relationship) {
      p2 = `During team discussions, ${protagonist} focused on nurturing a strong working **relationship** among colleagues, recognizing that open dialogue prevents misunderstandings and fosters mutual trust.`;
    } else {
      p2 = `Throughout the morning, ${protagonist} collaborated with the team to ensure that every task was managed with clear expectations and mutual encouragement.`;
    }

    p3 = `In the afternoon, the group tackled a complex project milestone together, applying constructive feedback to refine their strategic goals and streamline daily operations.`;

    p4 = `By the end of the day, fostering open communication and mutual respect proved that a supportive culture drives sustainable success, leaving the entire team energized for the week ahead.`;

    // 100% Story-Grounded Questions
    questions.push({
      id: 'q-1',
      question: `According to the story, what has become a top priority **nowadays** in modern organizations?`,
      options: [
        `Creating a positive and supportive work **environment**.`,
        `Requiring staff members to work in total silence without breaks.`,
        `Canceling all team meetings and working in complete isolation.`,
        `Replacing human employees with automated systems.`,
      ],
      correctAnswer: 0,
      explanation: `The opening paragraph states that creating a positive work environment has become a top priority nowadays.`,
    });

    questions.push({
      id: 'q-2',
      question: `Why is a respectful **relationship** between a **boss** and each **employee** so valuable in the passage?`,
      options: [
        `It encourages open communication, active listening, and effortless collaboration.`,
        `It allows the manager to cancel upcoming projects without explanation.`,
        `It forces staff members to compete against one another for promotions.`,
        `It eliminates the need for any daily schedules or planning.`,
      ],
      correctAnswer: 0,
      explanation: `The narrative explains that when a boss and employees share a respectful relationship, team collaboration becomes natural and effortless.`,
    });

    questions.push({
      id: 'q-3',
      question: `What was the primary conclusion reached by ${protagonist} and the team by the end of the day?`,
      options: [
        `That open communication, mutual respect, and a supportive culture drive lasting success.`,
        `That workplace culture has no meaningful impact on team performance.`,
        `That staff members should avoid collaborating with their colleagues.`,
        `That daily routines create unnecessary complications in the office.`,
      ],
      correctAnswer: 0,
      explanation: `The conclusion highlights that fostering open communication and mutual respect drives sustainable success.`,
    });
  }
  // SCENARIO 2: Morning Routine, Fitness & Adapting to Weather (e.g., storm, workout, job, moment, weather)
  else if ((storm || weather) && (workout || job)) {
    title = `Balancing Fitness and Daily Focus (${levelLabel})`;

    if (storm && workout) {
      p1 = `The morning began with an unexpected turn in the atmosphere. Noticing a brewing **${storm.word}** outside, ${protagonist} decided to stay indoors and complete an energizing **${workout.word}** to build stamina and mental clarity before starting the day.`;
    } else if (workout) {
      p1 = `The morning started with great energy as ${protagonist} dedicated thirty minutes to an energizing **${workout.word}**, setting a calm and positive tone for the upcoming schedule.`;
    } else {
      const wWord = weather || storm;
      p1 = `Early in the morning, ${protagonist} checked the forecast and observed the unpredictable **${wWord?.word}** settling across the city, making early organization essential.`;
    }

    // Naturally weave any fitness & wellness words if present
    const treadmillWord = profiles.find((p) => p.word.toLowerCase() === 'treadmill');
    const stretchWord = profiles.find((p) => p.word.toLowerCase() === 'stretch');
    const relaxWord = profiles.find((p) => ['relax', 'unwind'].includes(p.word.toLowerCase()));

    p2 = `After warming up, settling into a focused routine brought noticeable calm and physical energy.`;
    if (treadmillWord) {
      p2 += ` Setting a steady pace on the **${treadmillWord.word}** helped build cardiovascular stamina and clear the mind.`;
    }

    if (job && moment) {
      p3 = `Later at their **${job.word}**, ${protagonist} met with colleagues to prioritize weekly deliverables. During a busy afternoon session, taking a quiet **${moment.word}** to reflect on current progress helped clarify the best path forward.`;
    } else if (job) {
      p3 = `Transitioning smoothly into the workday, ${protagonist} focused on the core responsibilities of their **${job.word}**, ensuring communication with colleagues remained clear and prompt.`;
    } else {
      p3 = `Throughout the afternoon, the team collaborated smoothly to review key assignments and align on upcoming goals.`;
    }

    if (stretchWord) {
      p3 += ` Taking a brief pause between meetings to **${stretchWord.word}** relieved physical tension and restored focus.`;
    }

    const wrapWord = weather && weather !== storm ? weather.word : 'routine';
    p4 = `By late afternoon, completing all scheduled tasks brought a genuine sense of accomplishment. Taking a moment to appreciate the changing **${wrapWord}** reminded everyone that consistent daily habits create lasting balance.`;

    if (relaxWord) {
      p4 += ` As evening arrived, taking time to **${relaxWord.word}** provided the perfect conclusion to a healthy, productive day.`;
    }

    questions.push({
      id: 'q-1',
      question: storm
        ? `According to the story, why did ${protagonist} complete their morning routine indoors?`
        : `What did ${protagonist} do at the start of the day to prepare for the schedule?`,
      options: storm
        ? [
            `Because an unexpected **${storm.word}** disrupted outdoor plans.`,
            `Because the office building was permanently closed.`,
            `Because ${protagonist} decided to postpone work until next month.`,
            `Because all fitness centers were undergoing renovations.`,
          ]
        : [
            `Focused on energizing habits to establish clarity and stamina.`,
            `Ignored the daily schedule and stayed asleep.`,
            `Cancelled all upcoming appointments without notice.`,
            `Delegated all responsibilities to an outside agency.`,
          ],
      correctAnswer: 0,
      explanation: storm
        ? `The story states that noticing a brewing storm outside prompted staying indoors.`
        : `The text highlights that establishing positive habits provided energy and focus.`,
    });

    questions.push({
      id: 'q-2',
      question: job
        ? `How did ${protagonist} maintain productivity at their **${job.word}** during the afternoon?`
        : `What happened during the afternoon collaboration?`,
      options: [
        `By prioritizing key deliverables and taking a quiet moment to evaluate progress.`,
        `By restarting the entire project from scratch after lunch.`,
        `By leaving the workplace early without informing colleagues.`,
        `By ignoring emails and avoiding all team discussions.`,
      ],
      correctAnswer: 0,
      explanation: `The narrative explains that reviewing deliverables and taking a moment of reflection kept work on track.`,
    });

    questions.push({
      id: 'q-3',
      question: `What overall takeaway did the narrative emphasize regarding daily routines?`,
      options: [
        `That consistent daily habits and steady focus create lasting balance and success.`,
        `That morning preparation has no influence on daytime productivity.`,
        `That weather changes make workplace collaboration impossible.`,
        `That planning ahead causes unnecessary delays.`,
      ],
      correctAnswer: 0,
      explanation: `The passage concludes that consistent daily habits create lasting balance and success.`,
    });
  }
  // SCENARIO 3: Dynamic Contextual Narrative Synthesizer (Zero Formulaic Templates)
  else {

    const themes = [
      {
        title: `Everyday Focus and Teamwork (${levelLabel})`,
        settingEn: 'collaborative workshop',
      },
      {
        title: `A Morning of Clear Direction (${levelLabel})`,
        settingEn: 'productive studio space',
      },
      {
        title: `Practical Steps in Daily Life (${levelLabel})`,
        settingEn: 'community project setting',
      },
    ];
    const chosenTheme = themes[Math.abs(words.join('').length) % themes.length];
    title = chosenTheme.title;

    const buildNaturalClause = (p: LexicalWordProfile, role: 'intro' | 'action' | 'pivot' | 'conclusion'): string => {
      const w = `**${p.word}**`;
      const pos = p.partOfSpeech;
      const lower = p.word.toLowerCase();

      // Special natural constructions for common tricky words
      if (lower === 'need') {
        if (role === 'intro') return `recognizing an immediate ${w} for clear organization`;
        if (role === 'action') return `the team realized they would ${w} additional time to finalize everything properly`;
        if (role === 'pivot') return `they discovered they still had a genuine ${w} for clearer instructions`;
        return `addressing every essential ${w} brought confidence to the group`;
      }
      if (lower === 'small') {
        if (role === 'intro') return `taking note of even a ${w} initial detail`;
        if (role === 'action') return `paying close attention to each ${w} adjustment as work unfolded`;
        if (role === 'pivot') return `realizing that even a ${w} change in strategy could resolve the challenge`;
        return `delivering a series of ${w} yet impactful improvements`;
      }
      if (lower === 'watch') {
        if (role === 'intro') return `taking time to ${w} how the process was handled`;
        if (role === 'action') return `pausing to ${w} the progress made so far`;
        if (role === 'pivot') return `stepping back to carefully ${w} the outcome of the initial trial`;
        return `taking pride in being able to ${w} their hard work bear fruit`;
      }
      if (lower === 'start') {
        if (role === 'intro') return `taking the initiative to ${w} the morning with clear intentions`;
        if (role === 'action') return `working diligently to ${w} on the core milestones without hesitation`;
        if (role === 'pivot') return `it was helpful to ${w} fresh with an updated perspective`;
        return `knowing that a steady ${w} had set the stage for great results`;
      }

      if (pos === 'verb') {
        if (role === 'intro') return `taking decisive action to ${w} the initial phase smoothly`;
        if (role === 'action') return `working side by side to ${w} the key steps effectively`;
        if (role === 'pivot') return `it became crucial to ${w} the pending action before proceeding`;
        return `investing genuine effort to ${w} the process produced rewarding outcomes`;
      }
      if (pos === 'adjective') {
        if (role === 'intro') return `maintaining a ${w} outlook as the schedule got underway`;
        if (role === 'action') return `ensuring that the workflow remained ${w} and coordinated`;
        if (role === 'pivot') return `adapting to unexpected feedback while staying ${w} and determined`;
        return `achieving a ${w} result that satisfied everyone involved`;
      }
      if (pos === 'adverb') {
        if (role === 'intro') return `approaching the day ${w} set a steady pace`;
        if (role === 'action') return `communicating ${w} with peers prevented misunderstandings`;
        return `moving forward ${w} ensured that goals were achieved smoothly`;
      }
      if (role === 'intro') return `directing attention toward the central ${w}`;
      if (role === 'action') return `coordinating tasks around each important ${w}`;
      if (role === 'pivot') return `evaluating the impact of this particular ${w} clarified the next steps`;
      return `celebrating the successful completion of the ${w}`;
    };

    const total = profiles.length;
    const p1Words = profiles.slice(0, 1);
    const p2Words = profiles.slice(1, Math.min(3, total));
    const p3Words = profiles.slice(3, Math.min(4, total));
    const p4Words = profiles.slice(4);

    const p1Parts: string[] = [];
    if (p1Words.length >= 1) {
      p1Parts.push(`The day commenced with focus as Alex gathered materials, ${buildNaturalClause(p1Words[0], 'intro')}.`);
    } else {
      p1Parts.push(`The day commenced with clear focus as the group gathered to coordinate priorities.`);
    }
    p1Parts.push(`Establishing shared objectives early on gave the team confidence to move forward smoothly.`);
    p1 = p1Parts.join(' ');

    const p2Parts: string[] = [];
    if (p2Words.length >= 1) {
      p2Parts.push(`During the morning session, ${buildNaturalClause(p2Words[0], 'action')}.`);
    } else {
      p2Parts.push(`During the morning session, colleagues shared actionable insights and coordinated their efforts.`);
    }
    if (p2Words.length >= 2) {
      p2Parts.push(`At the same time, ${buildNaturalClause(p2Words[1], 'action')}.`);
    } else {
      p2Parts.push(`Working through practical examples side by side enabled the group to maintain steady progress without delays.`);
    }
    p2 = p2Parts.join(' ');

    const p3Parts: string[] = [];
    if (p3Words.length >= 1) {
      p3Parts.push(`As the afternoon progressed, ${buildNaturalClause(p3Words[0], 'pivot')}.`);
    } else {
      p3Parts.push(`Navigating unexpected questions during the review required creative problem-solving.`);
    }
    p3Parts.push(`Taking time to review feedback with peers clarified the best route to achieve top quality.`);
    p3 = p3Parts.join(' ');

    const p4Parts: string[] = [];
    if (p4Words.length >= 1) {
      p4Parts.push(`Before concluding the session, ${buildNaturalClause(p4Words[0], 'conclusion')}.`);
    } else {
      p4Parts.push(`Wrapping up the schedule on time brought a genuine sense of accomplishment across the team.`);
    }
    p4Parts.push(`Reflecting on the experience proved once again that thoughtful collaboration and steady habits create lasting confidence.`);
    p4 = p4Parts.join(' ');

    questions.push({
      id: 'q-1',
      question: `According to the narrative, how did the group begin their day?`,
      options: [
        `By establishing shared objectives and focusing on immediate priorities.`,
        `By canceling their scheduled plans and leaving the venue.`,
        `By postponing all communications until the following week.`,
        `By refusing to cooperate with colleagues during the morning.`,
      ],
      correctAnswer: 0,
      explanation: `The opening paragraph explains that establishing shared objectives early gave the team confidence to proceed.`,
    });

    questions.push({
      id: 'q-2',
      question: `What helped the team maintain momentum during the collaboration?`,
      options: [
        `Addressing practical challenges step by step and reviewing feedback together.`,
        `Ignoring suggestions from colleagues and working in isolation.`,
        `Discarding their project notes and starting over from the beginning.`,
        `Leaving the workspace early without completing the tasks.`,
      ],
      correctAnswer: 0,
      explanation: `The middle paragraphs highlight that addressing steps together and reviewing feedback clarified the best path forward.`,
    });

    questions.push({
      id: 'q-3',
      question: `What was the key takeaway emphasized at the conclusion of the story?`,
      options: [
        `That thoughtful collaboration and steady habits create lasting confidence.`,
        `That planning ahead creates unnecessary complications in daily routines.`,
        `That team members should avoid discussing challenges with each other.`,
        `That morning preparation has no influence on afternoon results.`,
      ],
      correctAnswer: 0,
      explanation: `The concluding paragraph highlights that thoughtful collaboration and steady habits create lasting confidence.`,
    });
  }

  // Ensure all words are present in the final story text across exactly 4 paragraphs
  let fullStoryText = [p1, p2, p3, p4].filter(Boolean).join('\n\n');

  // Verify all words have been highlighted; if any missing, append naturally
  const missingWords = profiles.filter(
    (p) => !fullStoryText.toLowerCase().includes(p.word.toLowerCase())
  );
  if (missingWords.length > 0) {
    const extraSentences: string[] = [];
    missingWords.forEach((m) => {
      if (m.partOfSpeech === 'verb') {
        extraSentences.push(`Taking time to **${m.word}** during the day helped ${protagonist} stay refreshed and focused.`);
      } else if (m.partOfSpeech === 'adverb') {
        extraSentences.push(`Approaching daily tasks **${m.word}** made every conversation much more effective.`);
      } else if (m.partOfSpeech === 'adjective') {
        extraSentences.push(`Maintaining an **${m.word}** outlook kept team morale high throughout the afternoon.`);
      } else {
        extraSentences.push(`Additionally, paying close attention to the **${m.word}** ensured that nothing was overlooked.`);
      }
    });
    fullStoryText += `\n\n${extraSentences.join(' ')}`;
  }

  return {
    title,
    text: fullStoryText,
    questions,
  };
}

/**
 * Builds authentic Fill-in-the-Blanks challenges using the real definition and example sentence
 * of each word, eliminating nonsensical slot templates and strictly matching parts of speech for distractors.
 */
export function synthesizeFillInBlanks(
  words: string[],
  wordDetails?: Array<{
    word: string;
    definitionEn?: string;
    translationPt?: string;
    exampleSentence?: string;
  }>
): FillInBlankItem[] {
  const NOUN_DISTRACTORS = ['schedule', 'routine', 'practice', 'update', 'meeting', 'project', 'balance', 'culture', 'priority', 'task', 'goal', 'habit', 'feedback', 'strategy'];
  const VERB_DISTRACTORS = ['review', 'manage', 'organize', 'develop', 'prepare', 'improve', 'practice', 'coordinate', 'finish', 'start', 'learn', 'deliver'];
  const ADJ_DISTRACTORS = ['productive', 'effective', 'creative', 'consistent', 'calm', 'confident', 'simple', 'essential', 'focused', 'clear', 'natural', 'smooth'];
  const ADV_DISTRACTORS = ['nowadays', 'always', 'already', 'soon', 'regularly', 'smoothly', 'clearly', 'consistently', 'frequently', 'rarely', 'early', 'often'];

  // Map each word to its profile for POS matching
  const profileMap = new Map<string, LexicalWordProfile>();
  words.forEach((w) => {
    const detail = wordDetails?.find((d) => d.word.toLowerCase().trim() === w.toLowerCase().trim());
    profileMap.set(w.toLowerCase().trim(), profileWord(w, detail));
  });

  const PRONOUN_WORDS = new Set(['nobody', 'everyone', 'anyone', 'somebody', 'someone', 'anybody', 'everybody']);

  return words.map((w, idx) => {
    const cleanW = w.trim();
    const lowerW = cleanW.toLowerCase();
    const profile = profileMap.get(lowerW) || profileWord(cleanW);
    const pos = profile.partOfSpeech;

    // 1. Pick distractors that strictly match the part of speech
    let options: string[] = [cleanW];

    if (PRONOUN_WORDS.has(lowerW)) {
      const pronounDistractors = ['everyone', 'nobody', 'anyone', 'someone', 'somebody'].filter(
        (p) => p !== lowerW
      );
      options.push(...pronounDistractors.slice(0, 3));
    } else if (lowerW === 'awesome') {
      options.push('terrible', 'ordinary', 'average');
    } else if (lowerW === 'spot on' || lowerW === 'spot-on') {
      options.push('inaccurate', 'misguided', 'unclear');
    } else {
      // First, look for other student words that share the same POS
      const samePosStudentWords = words
        .filter((other) => {
          if (other.toLowerCase().trim() === lowerW) return false;
          const otherProf = profileMap.get(other.toLowerCase().trim());
          return otherProf?.partOfSpeech === pos && !PRONOUN_WORDS.has(other.toLowerCase().trim());
        })
        .slice(0, 3);

      options.push(...samePosStudentWords);

      // Fill remaining slots from high-frequency POS pool so distractors are always grammatically coherent
      const pool = pos === 'verb'
        ? VERB_DISTRACTORS
        : pos === 'adjective'
        ? ADJ_DISTRACTORS
        : pos === 'adverb'
        ? ADV_DISTRACTORS
        : NOUN_DISTRACTORS;

      let poolIdx = 0;
      while (options.length < 4 && poolIdx < pool.length * 2) {
        const cand = pool[poolIdx++ % pool.length];
        if (!options.some((opt) => opt.toLowerCase() === cand.toLowerCase()) && cand.toLowerCase() !== lowerW) {
          options.push(cand);
        }
      }
    }

    // Escape regex special characters
    const escaped = cleanW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = new RegExp(`\\b${escaped}\\b`, 'i');
    let sentenceWithBlank = '';

    if (lowerW === 'nobody') {
      sentenceWithBlank = '______ was in the meeting room when I arrived early this morning.';
    } else if (lowerW === 'everyone') {
      sentenceWithBlank = '______ agreed on the new schedule during our weekly team meeting.';
    } else if (lowerW === 'anyone') {
      sentenceWithBlank = 'Did ______ remember to share the updated notes after the team presentation?';
    } else if (lowerW === 'somebody' || lowerW === 'someone') {
      sentenceWithBlank = '______ left an umbrella by the office entrance before the rain started.';
    } else if (lowerW === 'awesome') {
      sentenceWithBlank = 'The team did an ______ job delivering the final project ahead of the deadline.';
    } else if (lowerW === 'spot on' || lowerW === 'spot-on') {
      sentenceWithBlank = 'Her analysis of the project challenges was completely ______.';
    } else if (profile.exampleSentenceEn && !isGenericText(profile.exampleSentenceEn) && wordRegex.test(profile.exampleSentenceEn)) {
      sentenceWithBlank = profile.exampleSentenceEn.replace(wordRegex, '______');
    } else {
      switch (profile.category) {
        case 'people':
          sentenceWithBlank = `Our team collaborated closely with the new ______ to organize the project deliverables.`;
          break;
        case 'relation':
          sentenceWithBlank = `Building a respectful working ______ with colleagues fosters trust and productive collaboration.`;
          break;
        case 'setting':
          sentenceWithBlank = `Creating a calm, organized work ______ helps everyone stay focused throughout the day.`;
          break;
        case 'time':
          sentenceWithBlank = `Taking a short break during a busy ______ helps restore focus and mental clarity.`;
          break;
        case 'weather':
          sentenceWithBlank = `We adjusted our commute plan because the sudden change in the ______ made traveling slower.`;
          break;
        case 'fitness':
          sentenceWithBlank = `Completing a steady ______ early in the morning energizes both body and mind for the day.`;
          break;
        case 'work':
          sentenceWithBlank = `Completing every milestone on time required steady focus on this key ______ from the team.`;
          break;
        case 'communication':
          sentenceWithBlank = `We scheduled a constructive ______ to align on client expectations before the deadline.`;
          break;
        case 'emotion':
          sentenceWithBlank = `Consistent daily speaking practice builds authentic ______ when talking with native speakers.`;
          break;
        default:
          if (profile.partOfSpeech === 'verb') {
            sentenceWithBlank = `Before finalizing the project deliverables, the team needs to ______ each detail carefully.`;
          } else if (profile.partOfSpeech === 'adjective') {
            sentenceWithBlank = `Our department adopted a ______ approach that simplified the entire workflow.`;
          } else if (profile.partOfSpeech === 'adverb') {
            sentenceWithBlank = `She explained the core objectives ______ so that every participant understood clearly.`;
          } else {
            sentenceWithBlank = `Having a clear and structured ______ helps the team deliver high quality results on time.`;
          }
      }
    }

    // Deterministic sort for options so choices remain stable on every render and reload
    const stableOptions = [...new Set(options.slice(0, 4))];
    while (stableOptions.length < 4) {
      stableOptions.push(`choice-${stableOptions.length + 1}`);
    }
    const sortedOptions = [...stableOptions].sort((a, b) => {
      const hashA = (a + lowerW).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const hashB = (b + lowerW).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      return hashA - hashB || a.localeCompare(b);
    });

    const stableId = `fill-${lowerW.replace(/[^a-z0-9]/g, '_')}`;

    return {
      id: stableId,
      sentenceWithBlank,
      correctWord: cleanW,
      options: sortedOptions,
      hintPt: `Dica contextual: Encaixa com o sentido de "${profile.translationPt}".`,
      hintEn: `Context clue: Choose the word that best expresses "${profile.definitionEn.slice(0, 65)}...".`,
      explanationPt: `A palavra "${cleanW}" (${profile.translationPt}) completa a frase com precisão semântica e gramatical.`,
      explanationEn: `"${cleanW}" is the only choice that logically and grammatically fits this specific context.`,
    };
  });
}
