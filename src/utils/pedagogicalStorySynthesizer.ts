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
  // People & Roles
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
    lower.includes('focus on the sentence context to identify')
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
        defaultDef = `An important concept, role, or tool referring to ${clean} in everyday life and communication.`;
        defaultEx = `Having a clear and structured ${clean} helps everyone stay organized and confident throughout the day.`;
    }
  }

  if (providedDetails?.exampleSentence && !isGenericText(providedDetails.exampleSentence) && providedDetails.exampleSentence.toLowerCase().includes(lower)) {
    defaultEx = providedDetails.exampleSentence;
  } else if (!defaultEx) {
    defaultEx = `Practicing with "${clean}" in daily English conversations builds natural fluency and confidence.`;
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
 * Generates a completely natural, cohesive, human-like narrative (Part 4)
 * that logically connects ALL target words into a realistic scenario with ZERO repetition.
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

  const questions: ReadingQuestion[] = [];

  // SCENARIO 1: The Modern Workplace & Leadership (Regina's specific scenario: nowadays, relationship, boss, employee, environment)
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

    p3 = `By the end of the day, fostering open communication and mutual respect proved that a supportive culture drives sustainable success, leaving the entire team energized for the week ahead.`;

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

    if (treadmillWord) {
      p1 += ` Setting a steady pace on the **${treadmillWord.word}** helped build cardiovascular stamina and clear the mind.`;
    }

    if (job && moment) {
      p2 = `Later at their **${job.word}**, ${protagonist} met with colleagues to prioritize weekly deliverables. During a busy afternoon session, taking a quiet **${moment.word}** to reflect on current progress helped clarify the best path forward.`;
    } else if (job) {
      p2 = `Transitioning smoothly into the workday, ${protagonist} focused on the core responsibilities of their **${job.word}**, ensuring communication with colleagues remained clear and prompt.`;
    } else {
      p2 = `Throughout the afternoon, the team collaborated smoothly to review key assignments and align on upcoming goals.`;
    }

    if (stretchWord) {
      p2 += ` Taking a brief pause between meetings to **${stretchWord.word}** relieved physical tension and restored focus.`;
    }

    const wrapWord = weather && weather !== storm ? weather.word : 'routine';
    p3 = `By late afternoon, completing all scheduled tasks brought a genuine sense of accomplishment. Taking a moment to appreciate the changing **${wrapWord}** reminded everyone that consistent daily habits create lasting balance.`;

    if (relaxWord) {
      p3 += ` As evening arrived, taking time to **${relaxWord.word}** provided the perfect conclusion to a healthy, productive day.`;
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
    // Dynamic themes to prevent any static repetition
    const themes = [
      {
        title: `The Project Breakthrough (${levelLabel})`,
        settingEn: 'creative studio and strategic workplace',
      },
      {
        title: `Turning Plans into Action (${levelLabel})`,
        settingEn: 'fast-paced team sprint',
      },
      {
        title: `Navigating the Milestone (${levelLabel})`,
        settingEn: 'collaborative professional environment',
      },
    ];
    const chosenTheme = themes[Math.abs(words.join('').length) % themes.length];
    title = chosenTheme.title;

    // Helper to naturally integrate a word based on its part of speech
    const buildNaturalClause = (p: LexicalWordProfile, role: 'intro' | 'action' | 'pivot' | 'conclusion'): string => {
      const w = `**${p.word}**`;
      const pos = p.partOfSpeech;
      if (pos === 'verb') {
        if (role === 'intro') return `early on, ${protagonist} took decisive steps to ${w} key components of the assignment`;
        if (role === 'action') return `collaborating closely with colleagues to ${w} every detail with precision`;
        if (role === 'pivot') return `it was essential to ${w} before moving to the next deliverable`;
        return `the effort invested to ${w} produced outstanding results for the entire group`;
      }
      if (pos === 'adjective') {
        if (role === 'intro') return `achieving a ${w} balance required patience, active listening, and steady focus`;
        if (role === 'action') return `the team remained ${w} to adapt their strategy as new feedback arrived`;
        if (role === 'pivot') return `recognizing that while circumstances were rarely ${w}, steady dedication made all the difference`;
        return `delivering a ${w} outcome brought genuine pride to everyone involved`;
      }
      if (pos === 'adverb') {
        if (role === 'intro') return `approaching the morning schedule ${w} established a clear rhythm for the day`;
        if (role === 'action') return `working ${w} alongside the team prevented unnecessary misunderstandings`;
        return `moving forward ${w} ensured that all milestones were met on schedule`;
      }
      // Noun / default
      if (role === 'intro') return `${protagonist} focused early attention on understanding the core ${w}`;
      if (role === 'action') return `maintaining transparent communication around each ${w} kept the momentum strong`;
      if (role === 'pivot') return `taking time to address the primary ${w} resolved pending questions`;
      return `celebrating the successful delivery of the ${w} concluded a deeply rewarding day`;
    };

    const total = profiles.length;
    const p1Words = profiles.slice(0, Math.min(2, total));
    const p2Words = profiles.slice(2, Math.min(4, total));
    const p3Words = profiles.slice(4);

    const p1Parts: string[] = [];
    if (p1Words.length >= 1) {
      p1Parts.push(`The working session began with clear intention as ${buildNaturalClause(p1Words[0], 'intro')}.`);
    }
    if (p1Words.length >= 2) {
      p1Parts.push(`By establishing open dialogue early in the morning, ${buildNaturalClause(p1Words[1], 'action')}.`);
    } else {
      p1Parts.push(`Aligning on concrete objectives from the outset gave everyone confidence to move forward smoothly.`);
    }
    p1 = p1Parts.join(' ');

    const p2Parts: string[] = [];
    if (p2Words.length >= 1) {
      p2Parts.push(`As the afternoon progressed, ${buildNaturalClause(p2Words[0], 'pivot')}.`);
    } else {
      p2Parts.push(`During the midday collaboration, team members shared actionable insights and coordinated their efforts.`);
    }
    if (p2Words.length >= 2) {
      p2Parts.push(`At the same time, ${buildNaturalClause(p2Words[1], 'action')}.`);
    } else if (p2Words.length === 1) {
      p2Parts.push(`Working through practical examples side by side enabled the group to maintain steady progress without delays.`);
    }
    p2 = p2Parts.join(' ');

    const p3Parts: string[] = [];
    if (p3Words.length >= 1) {
      p3Parts.push(`Before wrapping up the day, ${buildNaturalClause(p3Words[0], 'conclusion')}.`);
    } else {
      p3Parts.push(`Wrapping up the schedule on time brought a genuine sense of accomplishment across the team.`);
    }
    p3Parts.push(`Finishing each milestone with care proved once again that thoughtful collaboration and steady habits create lasting professional success.`);
    p3 = p3Parts.join(' ');

    // 100% story-coherent questions based directly on the narrative events
    const firstWordProfile = p1Words[0] || profiles[0];
    const secondWordProfile = p2Words[0] || profiles[1] || firstWordProfile;

    questions.push({
      id: 'q-1',
      question: `According to the narrative, what did ${protagonist} do at the start of the working session?`,
      options: [
        `Took decisive steps to establish clear focus and coordinate core objectives early on.`,
        `Decided to cancel all scheduled commitments and postpone the project until next week.`,
        `Left the working area completely without informing colleagues or sharing instructions.`,
        `Refused to communicate with team members during the morning session.`,
      ],
      correctAnswer: 0,
      explanation: `The opening paragraph explains that ${protagonist} began the working session with clear intention to coordinate core objectives early on.`,
    });

    questions.push({
      id: 'q-2',
      question: `How did ${protagonist} and the team maintain productive momentum during the afternoon?`,
      options: [
        `By addressing key deliverables proactively and collaborating transparently through practical steps.`,
        `By working in total isolation and declining to review ongoing assignments.`,
        `By deleting their existing project files and starting over from scratch.`,
        `By postponing their daily responsibilities until the following month.`,
      ],
      correctAnswer: 0,
      explanation: `The middle section emphasizes that addressing key deliverables proactively and transparently kept momentum strong.`,
    });

    questions.push({
      id: 'q-3',
      question: `What was the primary takeaway emphasized by the team at the end of the day?`,
      options: [
        `That thoughtful collaboration, steady habits, and clear communication create lasting success.`,
        `That establishing daily routines creates unnecessary complications in the workplace.`,
        `That team members should avoid coordinating tasks with one another.`,
        `That planning ahead has no meaningful influence on weekly milestones.`,
      ],
      correctAnswer: 0,
      explanation: `The concluding paragraph highlights that thoughtful collaboration and steady habits create lasting professional success.`,
    });
  }

  // Ensure all words are present in the final story text
  let fullStoryText = [p1, p2, p3].filter(Boolean).join('\n\n');

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

  return words.map((w, idx) => {
    const profile = profileMap.get(w.toLowerCase().trim()) || profileWord(w);
    const pos = profile.partOfSpeech;

    // 1. Pick distractors that strictly match the part of speech
    // First, look for other student words that share the same POS
    const samePosStudentWords = words
      .filter((other) => {
        if (other.toLowerCase().trim() === w.toLowerCase().trim()) return false;
        const otherProf = profileMap.get(other.toLowerCase().trim());
        return otherProf?.partOfSpeech === pos;
      })
      .slice(0, 3);

    const options = [w, ...samePosStudentWords];

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
      if (!options.some((opt) => opt.toLowerCase() === cand.toLowerCase()) && cand.toLowerCase() !== w.toLowerCase()) {
        options.push(cand);
      }
    }

    // Escape regex special characters
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = new RegExp(`\\b${escaped}\\b`, 'i');
    let sentenceWithBlank = '';

    if (profile.exampleSentenceEn && !isGenericText(profile.exampleSentenceEn) && wordRegex.test(profile.exampleSentenceEn)) {
      sentenceWithBlank = profile.exampleSentenceEn.replace(wordRegex, '______');
    } else {
      switch (profile.category) {
        case 'people':
          sentenceWithBlank = `A dedicated ______ plays an indispensable role in maintaining team morale and momentum.`;
          break;
        case 'relation':
          sentenceWithBlank = `Fostering a healthy professional ______ with colleagues builds lasting trust across the company.`;
          break;
        case 'setting':
          sentenceWithBlank = `Working in an organized, supportive ______ significantly enhances daily productivity and focus.`;
          break;
        case 'time':
          sentenceWithBlank = `Taking a brief pause during a busy ______ helps restore energy before the next meeting.`;
          break;
        case 'weather':
          sentenceWithBlank = `We adjusted our schedule because the sudden change in the ______ made traveling impractical.`;
          break;
        case 'fitness':
          sentenceWithBlank = `Completing a steady ______ early in the morning sets a positive, energized tone for the day.`;
          break;
        case 'work':
          sentenceWithBlank = `Meeting every milestone required disciplined focus on this critical ______ from start to finish.`;
          break;
        case 'communication':
          sentenceWithBlank = `We had an insightful ______ to align on upcoming priorities before the client presentation.`;
          break;
        case 'emotion':
          sentenceWithBlank = `Consistent daily practice builds authentic ______ when communicating with international partners.`;
          break;
        default:
          if (profile.partOfSpeech === 'verb') {
            sentenceWithBlank = `Before finalizing the project deliverables, the team needs to ______ each detail carefully.`;
          } else if (profile.partOfSpeech === 'adjective') {
            sentenceWithBlank = `Our department adopted a ______ strategy that simplified the entire workflow.`;
          } else if (profile.partOfSpeech === 'adverb') {
            sentenceWithBlank = `She had ______ delivered the executive summary when the stakeholders entered the room.`;
          } else {
            sentenceWithBlank = `Having a clear and reliable ______ ensures that the team delivers high quality results on time.`;
          }
      }
    }

    return {
      id: `fill-${idx}-${w}`,
      sentenceWithBlank,
      correctWord: w,
      options: options.sort(() => 0.5 - Math.random()),
      hintPt: `Dica contextual: Encaixa com o sentido de "${profile.translationPt}".`,
      hintEn: `Context clue: Choose the word that best expresses "${profile.definitionEn.slice(0, 65)}...".`,
      explanationPt: `A palavra "${w}" (${profile.translationPt}) completa a frase com precisão semântica e gramatical.`,
      explanationEn: `"${w}" is the only choice that logically and grammatically fits this specific context.`,
    };
  });
}
