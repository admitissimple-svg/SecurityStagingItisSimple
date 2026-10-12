import { Language } from '../../types';

export interface MemorizationTranslations {
  modalTitle: string;
  wordsCount: (count: number) => string;
  scoreBadge: (score: number) => string;
  aiGenerateBtn: string;
  generatingAi: string;
  generatingDailyActivity?: string;
  generatingDailyActivitySubtitle?: string;
  printBtn: string;
  close: string;
  weekLabelPrefix: string;
  tabs: {
    matching: string;
    fill: string;
    sentences: string;
    reading: string;
    results: string;
  };
  part1: {
    title: string;
    instruction: string;
    wordsBankLabel: string;
    selectPlaceholder: string;
    answeredCount: (answered: number, total: number) => string;
    nextBtn: string;
    pedagogicalSupportLabel: string;
  };
  part2: {
    title: string;
    instruction: string;
    completedCount: (completed: number, total: number) => string;
    backBtn: string;
    nextBtn: string;
    getPedagogicalHint: (word: string, hintPt?: string, hintEn?: string) => string;
  };
  part3: {
    title: string;
    instruction: string;
    getPedagogicalPrompt: (word: string, hintFromData?: string) => string;
    placeholder: (word: string) => string;
    checkWithAi: string;
    checking: string;
    suggestionLabel: string;
    greatSentence: string;
    backBtn: string;
    nextBtn: string;
  };
  part4: {
    title: string;
    instruction: string;
    listenBtn: string;
    backBtn: string;
    submitBtn: string;
  };
  results: {
    scoreTitle: string;
    congrats: string;
    sendTutorBtn: string;
    printBtn: string;
    doneBtn: string;
    keyTitle: string;
    vocabKeyLabel: string;
  };
  emptyState: {
    title: string;
    description: string;
    howToTitle: string;
    step1: string;
    step2: string;
    step3: string;
    backBtn: string;
  };
  toastSubmitted: string;
}

export const MEMORIZATION_I18N: Record<Language, MemorizationTranslations> = {
  en: {
    modalTitle: 'Weekly Memorization Activity',
    wordsCount: (count) => `${count} Words`,
    scoreBadge: (score) => `${score}% Score`,
    aiGenerateBtn: 'AI Generate',
    generatingAi: 'Generating...',
    generatingDailyActivity: 'Generating your personalized activity of the day...',
    generatingDailyActivitySubtitle: 'Connecting your daily vocabulary to Gemini AI to craft an authentic mini-story, smart blank challenges, and targeted comprehension questions...',
    printBtn: 'Print',
    close: 'Close',
    weekLabelPrefix: 'Week of',
    tabs: {
      matching: '🔗 Part 1: Matching',
      fill: '✏️ Part 2: Fill in Blanks',
      sentences: '✍️ Part 3: Sentences',
      reading: '📖 Part 4: Mini-Story',
      results: '🏆 Evaluation & Key',
    },
    part1: {
      title: 'Part 1: Match Words to Their Meaning',
      instruction: 'Select the corresponding word for each definition.',
      wordsBankLabel: 'Words:',
      selectPlaceholder: '-- Select word --',
      answeredCount: (answered, total) => `${answered}/${total} answered`,
      nextBtn: 'Next: Part 2',
      pedagogicalSupportLabel: 'Pedagogical support:',
    },
    part2: {
      title: 'Part 2: Complete the Routine Sentences',
      instruction: 'Select the word that best completes each routine context.',
      completedCount: (completed, total) => `${completed}/${total} completed`,
      backBtn: '← Back',
      nextBtn: 'Next: Part 3',
      getPedagogicalHint: (word, hintPt, hintEn) =>
        hintEn || `Hint: Select the target word "${word}" that naturally fits this routine situation.`,
    },
    part3: {
      title: 'Part 3: Sentence Writing',
      instruction: 'Write a complete English sentence applying each target word in a real daily situation.',
      getPedagogicalPrompt: (word) =>
        `Write a complete English sentence using "${word}" contextualized in your daily routine or professional life.`,
      placeholder: (word) => `Write your sentence in English using "${word}"...`,
      checkWithAi: 'Check with AI',
      checking: 'Checking...',
      suggestionLabel: 'Suggestion:',
      greatSentence: 'Great sentence!',
      backBtn: '← Back',
      nextBtn: 'Next: Part 4',
    },
    part4: {
      title: 'Part 4: Routine Reading & Interpretation',
      instruction: 'Read the short text connecting your weekly routine and answer the comprehension questions.',
      listenBtn: 'Listen',
      backBtn: '← Back',
      submitBtn: 'Submit & Grade',
    },
    results: {
      scoreTitle: 'Weekly Memorization Score',
      congrats: 'Great job! You consolidated all the vocabulary from your week into lasting English fluency habits.',
      sendTutorBtn: 'Send to Native Friend',
      printBtn: 'Print',
      doneBtn: 'Done / Close',
      keyTitle: 'Answer Key & Explanations',
      vocabKeyLabel: 'Vocabulary Key:',
    },
    emptyState: {
      title: 'No Weekly Vocabulary Registered Yet',
      description:
        'The Memorization Activity is 100% personalized and strictly utilizes the real words practiced by you during your week. To generate your 4-stage smart challenge, please add words in your daily routines or have your Native Friend annotate them during a live lesson.',
      howToTitle: 'How to activate your 4-stage challenge:',
      step1: 'Add target words to your Daily Routine activities (e.g. breakfast, work, commute, hobbies).',
      step2: 'Join a live lesson with your Native Friend so they can note real conversational terms.',
      step3: 'Save custom vocabulary to your Personal Dictionary.',
      backBtn: 'Back to Daily Routine',
    },
    toastSubmitted: 'Weekly memorization activity submitted to your teacher successfully!',
  },

  pt: {
    modalTitle: 'Atividade de Memorização da Rotina',
    wordsCount: (count) => `${count} Palavras`,
    scoreBadge: (score) => `${score}% Pontuação`,
    aiGenerateBtn: 'Gerar com IA',
    generatingAi: 'Gerando com IA...',
    generatingDailyActivity: 'Gerando sua atividade personalizada do dia...',
    generatingDailyActivitySubtitle: 'Conectando seu vocabulário diário ao Gemini AI para criar uma mini-história autêntica, exercícios de lacunas inteligentes e perguntas de interpretação...',
    printBtn: 'Imprimir',
    close: 'Fechar',
    weekLabelPrefix: 'Semana de',
    tabs: {
      matching: '🔗 Parte 1: Associação',
      fill: '✏️ Parte 2: Lacunas',
      sentences: '✍️ Parte 3: Frases',
      reading: '📖 Parte 4: Texto',
      results: '🏆 Avaliação & Gabarito',
    },
    part1: {
      title: 'Parte 1: Associe as Palavras ao Significado',
      instruction: 'Selecione a palavra correspondente para cada definição.',
      wordsBankLabel: 'Palavras:',
      selectPlaceholder: '-- Escolha a palavra --',
      answeredCount: (answered, total) => `${answered}/${total} respondidas`,
      nextBtn: 'Avançar: Parte 2',
      pedagogicalSupportLabel: 'Apoio pedagógico:',
    },
    part2: {
      title: 'Parte 2: Complete as Frases da Rotina',
      instruction: 'Selecione a palavra que melhor completa cada contexto da rotina.',
      completedCount: (completed, total) => `${completed}/${total} completadas`,
      backBtn: '← Voltar',
      nextBtn: 'Avançar: Parte 3',
      getPedagogicalHint: (word, hintPt) =>
        hintPt || `Dica pedagógica: Refere-se a "${word}".`,
    },
    part3: {
      title: 'Parte 3: Criação de Frases',
      instruction: 'Escreva uma frase completa em inglês aplicando cada palavra-chave na sua rotina diária.',
      getPedagogicalPrompt: (word) =>
        `Escreva uma frase completa em inglês usando "${word}" contextualizada na sua rotina diária ou profissional.`,
      placeholder: (word) => `Escreva sua frase em inglês usando "${word}"...`,
      checkWithAi: 'Verificar com IA',
      checking: 'Avaliando...',
      suggestionLabel: 'Sugestão:',
      greatSentence: 'Frase excelente!',
      backBtn: '← Voltar',
      nextBtn: 'Avançar: Parte 4',
    },
    part4: {
      title: 'Parte 4: Leitura & Interpretação da Rotina',
      instruction: 'Leia o texto conectando o vocabulário da sua semana e responda às perguntas.',
      listenBtn: 'Ouvir',
      backBtn: '← Voltar',
      submitBtn: 'Concluir & Corrigir Tarefa',
    },
    results: {
      scoreTitle: 'Nota da Atividade de Memorização',
      congrats: 'Parabéns pela dedicação! Você memorizou e consolidou o vocabulário praticado na sua rotina diária.',
      sendTutorBtn: 'Enviar ao Amigo Nativo',
      printBtn: 'Imprimir',
      doneBtn: 'Concluir e Fechar',
      keyTitle: 'Gabarito e Explicações Detalhadas',
      vocabKeyLabel: 'Gabarito das Palavras:',
    },
    emptyState: {
      title: 'Nenhum Vocabulário Cadastrado Nesta Semana',
      description:
        'A Atividade de Memorização é 100% personalizada e utiliza exclusivamente as palavras reais praticadas por você durante a semana. Para que a IA monte seus exercícios de Associação, Lacunas, Frases e Texto Integrado, cadastre palavras na sua rotina diária ou faça uma aula com seu Amigo Nativo.',
      howToTitle: 'Como ativar seus exercícios de memorização:',
      step1: 'Cadastre palavras-chave nas suas atividades da Rotina Diária (ex: café da manhã, trabalho, estudos, lazer).',
      step2: 'Participe de uma aula ao vivo com seu Amigo Nativo para que ele anote os termos da sua conversa.',
      step3: 'Consulte e salve termos no seu Dicionário Pessoal.',
      backBtn: 'Voltar para Minha Rotina',
    },
    toastSubmitted: 'Homework semanal enviada para o seu professor com sucesso!',
  },

  es: {
    modalTitle: 'Actividad de Memorización Semanal',
    wordsCount: (count) => `${count} Palabras`,
    scoreBadge: (score) => `${score}% Puntaje`,
    aiGenerateBtn: 'Generar con IA',
    generatingAi: 'Generando con IA...',
    generatingDailyActivity: 'Generando tu actividad personalizada del día...',
    generatingDailyActivitySubtitle: 'Conectando tu vocabulario diario con Gemini AI para crear una micro-historia auténtica, ejercicios con espacios inteligentes y preguntas contextuales...',
    printBtn: 'Imprimir',
    close: 'Cerrar',
    weekLabelPrefix: 'Semana del',
    tabs: {
      matching: '🔗 Parte 1: Asociación',
      fill: '✏️ Parte 2: Espacios en Blanco',
      sentences: '✍️ Parte 3: Oraciones',
      reading: '📖 Parte 4: Micro-historia',
      results: '🏆 Evaluación y Respuestas',
    },
    part1: {
      title: 'Parte 1: Asocia las Palabras con su Significado',
      instruction: 'Selecciona la palabra correspondiente para cada definición.',
      wordsBankLabel: 'Palabras:',
      selectPlaceholder: '-- Elige la palabra --',
      answeredCount: (answered, total) => `${answered}/${total} respondidas`,
      nextBtn: 'Siguiente: Parte 2',
      pedagogicalSupportLabel: 'Apoyo pedagógico:',
    },
    part2: {
      title: 'Parte 2: Completa las Frases de la Rutina',
      instruction: 'Selecciona la palabra que mejor complete cada contexto de la rutina.',
      completedCount: (completed, total) => `${completed}/${total} completadas`,
      backBtn: '← Volver',
      nextBtn: 'Siguiente: Parte 3',
      getPedagogicalHint: (word) => `Pista pedagógica: Completa con "${word}" según el contexto.`,
    },
    part3: {
      title: 'Parte 3: Redacción de Oraciones',
      instruction: 'Escribe una oración completa en inglés aplicando cada palabra clave en una situación real diaria.',
      getPedagogicalPrompt: (word) =>
        `Escribe una oración completa en inglés usando "${word}" contextualizada en tu rutina diaria o profesional.`,
      placeholder: (word) => `Escribe tu oración en inglés usando "${word}"...`,
      checkWithAi: 'Verificar con IA',
      checking: 'Evaluando...',
      suggestionLabel: 'Sugerencia:',
      greatSentence: '¡Excelente oración!',
      backBtn: '← Volver',
      nextBtn: 'Siguiente: Parte 4',
    },
    part4: {
      title: 'Parte 4: Lectura e Interpretación de la Rutina',
      instruction: 'Lee el texto que conecta el vocabulario de tu semana y responde las preguntas.',
      listenBtn: 'Escuchar',
      backBtn: '← Volver',
      submitBtn: 'Enviar y Calificar',
    },
    results: {
      scoreTitle: 'Puntaje de Memorización Semanal',
      congrats: '¡Gran trabajo! Has consolidado el vocabulario de tu semana en hábitos duraderos de fluidez.',
      sendTutorBtn: 'Enviar al Amigo Nativo',
      printBtn: 'Imprimir',
      doneBtn: 'Concluir y Cerrar',
      keyTitle: 'Respuestas y Explicaciones Detalladas',
      vocabKeyLabel: 'Clave de Vocabulario:',
    },
    emptyState: {
      title: 'Aún no hay Vocabulario Registrado Esta Semana',
      description:
        'La Actividad de Memorización es 100% personalizada y utiliza exclusivamente las palabras reales practicadas durante tu semana. Agrega palabras a tu rutina diaria o practica con tu Amigo Nativo para activarla.',
      howToTitle: 'Cómo activar tus ejercicios de memorización:',
      step1: 'Agrega palabras clave a tus actividades de la Rutina Diaria.',
      step2: 'Participa en una clase en vivo con tu Amigo Nativo.',
      step3: 'Guarda vocabulario en tu Diccionario Personal.',
      backBtn: 'Volver a Mi Rutina',
    },
    toastSubmitted: '¡Actividad semanal enviada a tu profesor con éxito!',
  },

  fr: {
    modalTitle: 'Activité de Mémorisation Hebdomadaire',
    wordsCount: (count) => `${count} Mots`,
    scoreBadge: (score) => `${score}% Score`,
    aiGenerateBtn: 'Générer avec IA',
    generatingAi: 'Génération...',
    printBtn: 'Imprimer',
    close: 'Fermer',
    weekLabelPrefix: 'Semaine du',
    tabs: {
      matching: '🔗 Partie 1 : Association',
      fill: '✏️ Partie 2 : Textes à Trous',
      sentences: '✍️ Partie 3 : Phrases',
      reading: '📖 Partie 4 : Micro-Histoire',
      results: '🏆 Évaluation & Corrigé',
    },
    part1: {
      title: 'Partie 1 : Associez les Mots à leur Définition',
      instruction: 'Sélectionnez le mot correspondant pour chaque définition.',
      wordsBankLabel: 'Mots :',
      selectPlaceholder: '-- Choisir le mot --',
      answeredCount: (answered, total) => `${answered}/${total} répondus`,
      nextBtn: 'Suivant : Partie 2',
      pedagogicalSupportLabel: 'Support pédagogique :',
    },
    part2: {
      title: 'Partie 2 : Complétez les Phrases de Routine',
      instruction: 'Sélectionnez le mot qui complète le mieux chaque contexte de routine.',
      completedCount: (completed, total) => `${completed}/${total} complétés`,
      backBtn: '← Retour',
      nextBtn: 'Suivant : Partie 3',
      getPedagogicalHint: (word) => `Indice : Utilisez "${word}" dans ce contexte.`,
    },
    part3: {
      title: 'Partie 3 : Rédaction de Phrases',
      instruction: 'Écrivez une phrase complète en anglais en appliquant chaque mot clé dans une situation quotidienne réelle.',
      getPedagogicalPrompt: (word) =>
        `Écrivez une phrase complète en anglais avec "${word}" contextualisée dans votre routine quotidienne ou professionnelle.`,
      placeholder: (word) => `Écrivez votre phrase en anglais avec "${word}"...`,
      checkWithAi: 'Vérifier avec IA',
      checking: 'Évaluation...',
      suggestionLabel: 'Suggestion :',
      greatSentence: 'Excellente phrase !',
      backBtn: '← Retour',
      nextBtn: 'Suivant : Partie 4',
    },
    part4: {
      title: 'Partie 4 : Lecture & Interprétation de la Routine',
      instruction: 'Lisez le texte intégrant votre vocabulaire hebdomadaire et répondez aux questions.',
      listenBtn: 'Écouter',
      backBtn: '← Retour',
      submitBtn: 'Valider et Noter',
    },
    results: {
      scoreTitle: 'Score de Mémorisation Hebdomadaire',
      congrats: 'Bravo pour votre travail ! Vous avez consolidé le vocabulaire de votre semaine.',
      sendTutorBtn: 'Envoyer à l’Ami Natif',
      printBtn: 'Imprimer',
      doneBtn: 'Terminer et Fermer',
      keyTitle: 'Corrigé et Explications',
      vocabKeyLabel: 'Mots Clés :',
    },
    emptyState: {
      title: 'Aucun Vocabulaire Enregistré Cette Semaine',
      description:
        'L’Activité de Mémorisation est 100% personnalisée et utilise uniquement les mots pratiqués dans votre routine. Ajoutez des mots dans votre routine ou participez à un cours avec votre Ami Natif.',
      howToTitle: 'Comment activer vos exercices :',
      step1: 'Ajoutez des mots clés dans vos activités de Routine Quotidienne.',
      step2: 'Participez à un cours en direct avec votre Ami Natif.',
      step3: 'Enregistrez des termes dans votre Dictionnaire Personnel.',
      backBtn: 'Retour à Ma Routine',
    },
    toastSubmitted: 'Activité hebdomadaire envoyée à votre professeur avec succès !',
  },

  de: {
    modalTitle: 'Wöchentliche Memorierungsaktivität',
    wordsCount: (count) => `${count} Wörter`,
    scoreBadge: (score) => `${score}% Punktzahl`,
    aiGenerateBtn: 'Mit KI generieren',
    generatingAi: 'Generiere...',
    printBtn: 'Drucken',
    close: 'Schließen',
    weekLabelPrefix: 'Woche vom',
    tabs: {
      matching: '🔗 Teil 1: Zuordnung',
      fill: '✏️ Teil 2: Lückentext',
      sentences: '✍️ Teil 3: Sätze',
      reading: '📖 Teil 4: Kurzgeschichte',
      results: '🏆 Auswertung & Lösungen',
    },
    part1: {
      title: 'Teil 1: Ordne Wörter ihren Bedeutungen zu',
      instruction: 'Wähle das passende Wort für jede Definition aus.',
      wordsBankLabel: 'Wörter:',
      selectPlaceholder: '-- Wort wählen --',
      answeredCount: (answered, total) => `${answered}/${total} beantwortet`,
      nextBtn: 'Weiter: Teil 2',
      pedagogicalSupportLabel: 'Pädagogische Unterstützung:',
    },
    part2: {
      title: 'Teil 2: Vervollständige die Routinesätze',
      instruction: 'Wähle das Wort, das den Routinekontext am besten ergänzt.',
      completedCount: (completed, total) => `${completed}/${total} abgeschlossen`,
      backBtn: '← Zurück',
      nextBtn: 'Weiter: Teil 3',
      getPedagogicalHint: (word) => `Hinweis: Setze "${word}" passend zum Kontext ein.`,
    },
    part3: {
      title: 'Teil 3: Satzbildung',
      instruction: 'Schreibe einen vollständigen englischen Satz mit jedem Zielwort in einer echten Alltagssituation.',
      getPedagogicalPrompt: (word) =>
        `Schreibe einen vollständigen englischen Satz mit "${word}" in deiner täglichen Routine oder im Beruf.`,
      placeholder: (word) => `Schreibe deinen Satz auf Englisch mit "${word}"...`,
      checkWithAi: 'Mit KI prüfen',
      checking: 'Überprüfe...',
      suggestionLabel: 'Vorschlag:',
      greatSentence: 'Toller Satz!',
      backBtn: '← Zurück',
      nextBtn: 'Weiter: Teil 4',
    },
    part4: {
      title: 'Teil 4: Routinetext & Verständnis',
      instruction: 'Lies den kurzen Text mit deinen Wochenvokabeln und beantworte die Fragen.',
      listenBtn: 'Anhören',
      backBtn: '← Zurück',
      submitBtn: 'Abschließen & Bewerten',
    },
    results: {
      scoreTitle: 'Memorierungs-Punktzahl',
      congrats: 'Tolle Arbeit! Du hast dein Wochenvokabular erfolgreich vertieft.',
      sendTutorBtn: 'An Native Friend senden',
      printBtn: 'Drucken',
      doneBtn: 'Fertig & Schließen',
      keyTitle: 'Lösungsschlüssel & Erklärungen',
      vocabKeyLabel: 'Wortübersicht:',
    },
    emptyState: {
      title: 'Noch kein Vokabular für diese Woche',
      description: 'Füge Wörter zu deiner Routine hinzu oder nimm an einer Stunde mit deinem Native Friend teil.',
      howToTitle: 'So aktivierst du die Übungen:',
      step1: 'Zielwörter in deiner Tagesroutine eintragen.',
      step2: 'Eine Stunde mit deinem Native Friend buchen.',
      step3: 'Wörter im persönlichen Wörterbuch speichern.',
      backBtn: 'Zurück zur Routine',
    },
    toastSubmitted: 'Aufgabe erfolgreich an deinen Tutor gesendet!',
  },

  it: {
    modalTitle: 'Attività di Memorizzazione Settimanale',
    wordsCount: (count) => `${count} Parole`,
    scoreBadge: (score) => `${score}% Punteggio`,
    aiGenerateBtn: 'Genera con IA',
    generatingAi: 'Generazione...',
    printBtn: 'Stampa',
    close: 'Chiudi',
    weekLabelPrefix: 'Settimana del',
    tabs: {
      matching: '🔗 Parte 1: Abbinamento',
      fill: '✏️ Parte 2: Inserimento',
      sentences: '✍️ Parte 3: Frasi',
      reading: '📖 Parte 4: Micro-storia',
      results: '🏆 Valutazione & Soluzioni',
    },
    part1: {
      title: 'Parte 1: Abbina le Parole al Significato',
      instruction: 'Seleziona la parola corrispondente per ogni definizione.',
      wordsBankLabel: 'Parole:',
      selectPlaceholder: '-- Scegli la parola --',
      answeredCount: (answered, total) => `${answered}/${total} risposte`,
      nextBtn: 'Avanti: Parte 2',
      pedagogicalSupportLabel: 'Supporto pedagogico:',
    },
    part2: {
      title: 'Parte 2: Completa le Frasi della Routine',
      instruction: 'Seleziona la parola che completa al meglio ogni contesto.',
      completedCount: (completed, total) => `${completed}/${total} completate`,
      backBtn: '← Indietro',
      nextBtn: 'Avanti: Parte 3',
      getPedagogicalHint: (word) => `Suggerimento: Usa "${word}" in questo contesto.`,
    },
    part3: {
      title: 'Parte 3: Creazione di Frasi',
      instruction: 'Scrivi una frase completa in inglese applicando ciascuna parola chiave nella tua routine quotidiana.',
      getPedagogicalPrompt: (word) =>
        `Scrivi una frase completa in inglese usando "${word}" contestualizzata nella tua routine quotidiana o professionale.`,
      placeholder: (word) => `Scrivi la tua frase in inglese con "${word}"...`,
      checkWithAi: 'Verifica con IA',
      checking: 'Valutazione...',
      suggestionLabel: 'Suggerimento:',
      greatSentence: 'Ottima frase!',
      backBtn: '← Indietro',
      nextBtn: 'Avanti: Parte 4',
    },
    part4: {
      title: 'Parte 4: Lettura & Comprensione della Routine',
      instruction: 'Leggi il testo che collega il vocabolario della settimana e rispondi alle domande.',
      listenBtn: 'Ascolta',
      backBtn: '← Indietro',
      submitBtn: 'Invia e Valuta',
    },
    results: {
      scoreTitle: 'Punteggio di Memorizzazione',
      congrats: 'Ottimo lavoro! Hai consolidato il vocabolario della tua settimana.',
      sendTutorBtn: 'Invia al Native Friend',
      printBtn: 'Stampa',
      doneBtn: 'Fatto / Chiudi',
      keyTitle: 'Soluzioni e Spiegazioni',
      vocabKeyLabel: 'Chiave del Vocabolario:',
    },
    emptyState: {
      title: 'Nessun Vocabolario Registrato Questa Settimana',
      description: 'Aggiungi parole alle tue routine giornaliere per attivare gli esercizi.',
      howToTitle: 'Come attivare la sfida:',
      step1: 'Aggiungi parole chiave alle tue attività quotidiane.',
      step2: 'Partecipa a una lezione dal vivo con il tuo Native Friend.',
      step3: 'Salva i termini nel tuo Dizionario Personale.',
      backBtn: 'Torna alla Routine',
    },
    toastSubmitted: 'Attività settimanale inviata con successo!',
  },

  ja: {
    modalTitle: '週間暗記・定着アクティビティ',
    wordsCount: (count) => `${count} 語`,
    scoreBadge: (score) => `${score}% スコア`,
    aiGenerateBtn: 'AIで生成',
    generatingAi: '生成中...',
    printBtn: '印刷',
    close: '閉じる',
    weekLabelPrefix: '週:',
    tabs: {
      matching: '🔗 第1部: 意味のマッチング',
      fill: '✏️ 第2部: 空欄補充',
      sentences: '✍️ 第3部: 英文作成',
      reading: '📖 第4部: ミニストーリー',
      results: '🏆 採点 & 解答',
    },
    part1: {
      title: '第1部: 単語と意味を結びつける',
      instruction: '各定義に対応する単語を選択してください。',
      wordsBankLabel: '対象単語:',
      selectPlaceholder: '-- 単語を選択 --',
      answeredCount: (answered, total) => `${answered}/${total} 回答済み`,
      nextBtn: '次へ: 第2部',
      pedagogicalSupportLabel: '学習サポート:',
    },
    part2: {
      title: '第2部: ルーティン文を完成させる',
      instruction: '各ルーティンの文脈に最も適した単語を選択してください。',
      completedCount: (completed, total) => `${completed}/${total} 完了`,
      backBtn: '← 戻る',
      nextBtn: '次へ: 第3部',
      getPedagogicalHint: (word) => `ヒント: 「${word}」を文脈に合わせて選びましょう。`,
    },
    part3: {
      title: '第3部: 実践英文作成',
      instruction: '実際の日常生活を想定し、対象単語を使った完全な英文を作成してください。',
      getPedagogicalPrompt: (word) =>
        `日常のルーティンや仕事の文脈に合わせて「${word}」を使った完全な英文を書いてください。`,
      placeholder: (word) => `「${word}」を使った英文を入力してください...`,
      checkWithAi: 'AIで添削',
      checking: '確認中...',
      suggestionLabel: '改善の提案:',
      greatSentence: '素晴らしい英文です！',
      backBtn: '← 戻る',
      nextBtn: '次へ: 第4部',
    },
    part4: {
      title: '第4部: ルーティン読解と理解度確認',
      instruction: '今週の単語をつなげた文章を読み、読解問題に回答してください。',
      listenBtn: '音声を聴く',
      backBtn: '← 戻る',
      submitBtn: '提出して採点',
    },
    results: {
      scoreTitle: '週間暗記スコア',
      congrats: '素晴らしい！今週学習した単語を日常の英語習慣としてしっかり定着させました。',
      sendTutorBtn: 'ネイティブ講師に送信',
      printBtn: '印刷',
      doneBtn: '完了して閉じる',
      keyTitle: '模範解答と解説',
      vocabKeyLabel: '単語一覧:',
    },
    emptyState: {
      title: '今週の登録単語がまだありません',
      description: '日課のルーティンに単語を追加するか、レッスンを受講して単語を登録してください。',
      howToTitle: 'アクティビティを開始する方法:',
      step1: 'デイリールーティンに学習単語を追加する。',
      step2: 'ネイティブフレンドとのレッスンで新しい表現を記録してもらう。',
      step3: '個人辞書に単語を保存する。',
      backBtn: 'ルーティンに戻る',
    },
    toastSubmitted: '課題が講師に正常に提出されました！',
  },

  ko: {
    modalTitle: '주간 단어 암기 및 복습 활동',
    wordsCount: (count) => `${count}개 단어`,
    scoreBadge: (score) => `${score}% 점수`,
    aiGenerateBtn: 'AI로 생성',
    generatingAi: '생성 중...',
    printBtn: '인쇄',
    close: '닫기',
    weekLabelPrefix: '주간:',
    tabs: {
      matching: '🔗 1단계: 단어 매칭',
      fill: '✏️ 2단계: 빈칸 채우기',
      sentences: '✍️ 3단계: 문장 작문',
      reading: '📖 4단계: 미니 스토리',
      results: '🏆 평가 & 정답',
    },
    part1: {
      title: '1단계: 단어와 의미 연결하기',
      instruction: '각 정의에 알맞은 단어를 선택하세요.',
      wordsBankLabel: '학습 단어:',
      selectPlaceholder: '-- 단어 선택 --',
      answeredCount: (answered, total) => `${answered}/${total} 답변 완료`,
      nextBtn: '다음: 2단계',
      pedagogicalSupportLabel: '학습 가이드:',
    },
    part2: {
      title: '2단계: 루틴 문장 완성하기',
      instruction: '문맥에 가장 자연스러운 단어를 선택하세요.',
      completedCount: (completed, total) => `${completed}/${total} 완료`,
      backBtn: '← 이전',
      nextBtn: '다음: 3단계',
      getPedagogicalHint: (word) => `힌트: 문맥에 맞는 "${word}"를 선택하세요.`,
    },
    part3: {
      title: '3단계: 실전 문장 작문',
      instruction: '실제 일상생활 상황에서 단어를 활용하여 완전한 영어 문장을 작성하세요.',
      getPedagogicalPrompt: (word) =>
        `일상 루틴이나 업무 상황에서 "${word}"를 활용한 완전한 영어 문장을 작성하세요.`,
      placeholder: (word) => `"${word}"를 사용한 영어 문장을 작성하세요...`,
      checkWithAi: 'AI 첨삭 받기',
      checking: '첨삭 중...',
      suggestionLabel: '추천 수정안:',
      greatSentence: '훌륭한 문장입니다!',
      backBtn: '← 이전',
      nextBtn: '다음: 4단계',
    },
    part4: {
      title: '4단계: 루틴 스토리 독해',
      instruction: '이번 주 단어들로 구성된 글을 읽고 이해도 질문에 답하세요.',
      listenBtn: '듣기',
      backBtn: '← 이전',
      submitBtn: '제출 및 채점',
    },
    results: {
      scoreTitle: '주간 단어 학습 점수',
      congrats: '잘하셨습니다! 이번 주 단어를 성공적으로 실전 영어 습관으로 정착시켰습니다.',
      sendTutorBtn: '원어민 튜터에게 전송',
      printBtn: '인쇄',
      doneBtn: '완료 및 닫기',
      keyTitle: '정답 및 해설',
      vocabKeyLabel: '어휘 정답:',
    },
    emptyState: {
      title: '이번 주 등록된 단어가 아직 없습니다',
      description: '루틴에 단어를 추가하거나 원어민 튜터와의 수업을 통해 단어를 기록해 보세요.',
      howToTitle: '연습 문제를 시작하는 방법:',
      step1: '일일 루틴 활동에 목표 단어 등록하기.',
      step2: '원어민 튜터와의 수업에 참여하기.',
      step3: '개인 사전에 단어 저장하기.',
      backBtn: '루틴으로 돌아가기',
    },
    toastSubmitted: '주간 과제가 튜터에게 성공적으로 제출되었습니다!',
  },

  zh: {
    modalTitle: '每周记忆与巩固活动',
    wordsCount: (count) => `${count} 个单词`,
    scoreBadge: (score) => `${score}% 得分`,
    aiGenerateBtn: 'AI 重新生成',
    generatingAi: '生成中...',
    printBtn: '打印',
    close: '关闭',
    weekLabelPrefix: '周:',
    tabs: {
      matching: '🔗 第一部分：词义配对',
      fill: '✏️ 第二部分：填空练习',
      sentences: '✍️ 第三部分：造句实践',
      reading: '📖 第四部分：情境短文',
      results: '🏆 评分与答案',
    },
    part1: {
      title: '第一部分：将单词与定义配对',
      instruction: '为每个英文释义选择相对应的目标单词。',
      wordsBankLabel: '目标单词：',
      selectPlaceholder: '-- 选择单词 --',
      answeredCount: (answered, total) => `${answered}/${total} 已作答`,
      nextBtn: '下一步：第二部分',
      pedagogicalSupportLabel: '教学辅导：',
    },
    part2: {
      title: '第二部分：完成日常句子',
      instruction: '选择最符合当前日常情境的正确单词。',
      completedCount: (completed, total) => `${completed}/${total} 已完成`,
      backBtn: '← 返回',
      nextBtn: '下一步：第三部分',
      getPedagogicalHint: (word) => `提示：结合日常语境选用 "${word}"。`,
    },
    part3: {
      title: '第三部分：英语造句实践',
      instruction: '在真实日常生活情境中，使用目标单词写一个完整的英文句子。',
      getPedagogicalPrompt: (word) =>
        `结合你的日常生活或工作情境，使用“${word}”写一个完整的英文句子。`,
      placeholder: (word) => `使用 "${word}" 写出你的英文句子...`,
      checkWithAi: 'AI 智能批改',
      checking: '批改中...',
      suggestionLabel: '批改建议：',
      greatSentence: '非常出色的句子！',
      backBtn: '← 返回',
      nextBtn: '下一步：第四部分',
    },
    part4: {
      title: '第四部分：日常短文阅读与理解',
      instruction: '阅读包含本周核心单词的短文，并回答理解问题。',
      listenBtn: '朗读音频',
      backBtn: '← 返回',
      submitBtn: '提交并评分',
    },
    results: {
      scoreTitle: '每周记忆得分',
      congrats: '太棒了！你已将本周学习的词汇融入到了长久的英语日常习惯中。',
      sendTutorBtn: '发送给外教老师',
      printBtn: '打印',
      doneBtn: '完成并关闭',
      keyTitle: '答案解析',
      vocabKeyLabel: '词汇答案：',
    },
    emptyState: {
      title: '本周尚未登记任何词汇',
      description: '记忆活动完全根据你本周实际接触的词汇量身打造。请在日常活动中添加单词或与外教老师连线学习。',
      howToTitle: '如何开启本周活动：',
      step1: '在每日日常活动中添加目标单词。',
      step2: '参加外教老师的一对一连线课。',
      step3: '将生词保存至个人生词本。',
      backBtn: '返回日常打卡',
    },
    toastSubmitted: '本周记忆作业已成功提交给老师！',
  },

  ru: {
    modalTitle: 'Еженедельное закрепление лексики',
    wordsCount: (count) => `${count} слов`,
    scoreBadge: (score) => `${score}% результат`,
    aiGenerateBtn: 'Создать с ИИ',
    generatingAi: 'Генерация...',
    printBtn: 'Печать',
    close: 'Закрыть',
    weekLabelPrefix: 'Неделя:',
    tabs: {
      matching: '🔗 Часть 1: Сопоставление',
      fill: '✏️ Часть 2: Пропуски',
      sentences: '✍️ Часть 3: Предложения',
      reading: '📖 Часть 4: Микро-история',
      results: '🏆 Оценка и ответы',
    },
    part1: {
      title: 'Часть 1: Сопоставьте слова с определениями',
      instruction: 'Выберите подходящее слово для каждого определения.',
      wordsBankLabel: 'Слова:',
      selectPlaceholder: '-- Выберите слово --',
      answeredCount: (answered, total) => `${answered}/${total} отвечено`,
      nextBtn: 'Далее: Часть 2',
      pedagogicalSupportLabel: 'Педагогическая подсказка:',
    },
    part2: {
      title: 'Часть 2: Заполните пропуски в предложениях',
      instruction: 'Выберите слово, которое лучше всего дополняет контекст рутины.',
      completedCount: (completed, total) => `${completed}/${total} заполнено`,
      backBtn: '← Назад',
      nextBtn: 'Далее: Часть 3',
      getPedagogicalHint: (word) => `Подсказка: Выберите "${word}" в соответствии с контекстом.`,
    },
    part3: {
      title: 'Часть 3: Составление предложений',
      instruction: 'Напишите полное предложение на английском, применив слово в реальной повседневной ситуации.',
      getPedagogicalPrompt: (word) =>
        `Напишите полное предложение на английском со словом «${word}» в контексте вашей повседневной жизни или работы.`,
      placeholder: (word) => `Напишите предложение на английском со словом «${word}»...`,
      checkWithAi: 'Проверить с ИИ',
      checking: 'Проверка...',
      suggestionLabel: 'Рекомендация:',
      greatSentence: 'Отличное предложение!',
      backBtn: '← Назад',
      nextBtn: 'Далее: Часть 4',
    },
    part4: {
      title: 'Часть 4: Чтение и понимание текста',
      instruction: 'Прочитайте короткий текст со словами недели и ответьте на вопросы.',
      listenBtn: 'Слушать',
      backBtn: '← Назад',
      submitBtn: 'Завершить и оценить',
    },
    results: {
      scoreTitle: 'Результат закрепления слов',
      congrats: 'Отличная работа! Вы закрепили словарный запас недели в привычке живого английского.',
      sendTutorBtn: 'Отправить преподавателю',
      printBtn: 'Печать',
      doneBtn: 'Готово / Закрыть',
      keyTitle: 'Ключи и пояснения',
      vocabKeyLabel: 'Словарь:',
    },
    emptyState: {
      title: 'На этой неделе пока нет слов',
      description: 'Добавьте слова в распорядок дня или запишитесь на урок с носителем.',
      howToTitle: 'Как активировать упражнения:',
      step1: 'Добавьте слова в ежедневную рутину.',
      step2: 'Посетите урок с носителем языка.',
      step3: 'Сохраняйте слова в личный словарь.',
      backBtn: 'Вернуться к рутине',
    },
    toastSubmitted: 'Домашняя работа успешно отправлена преподавателю!',
  },

  ar: {
    modalTitle: 'نشاط ترسيخ المفردات الأسبوعي',
    wordsCount: (count) => `${count} كلمات`,
    scoreBadge: (score) => `${score}% النتيجة`,
    aiGenerateBtn: 'توليد بالذكاء الاصطناعي',
    generatingAi: 'جاري التوليد...',
    printBtn: 'طباعة',
    close: 'إغلاق',
    weekLabelPrefix: 'أسبوع:',
    tabs: {
      matching: '🔗 الجزء 1: المطابقة',
      fill: '✏️ الجزء 2: ملء الفراغات',
      sentences: '✍️ الجزء 3: تكوين الجمل',
      reading: '📖 الجزء 4: قصة قصيرة',
      results: '🏆 التقييم والحلول',
    },
    part1: {
      title: 'الجزء 1: مطابقة الكلمات مع معانيها',
      instruction: 'اختر الكلمة المناسبة لكل تعريف.',
      wordsBankLabel: 'الكلمات:',
      selectPlaceholder: '-- اختر الكلمة --',
      answeredCount: (answered, total) => `${answered}/${total} تم الحل`,
      nextBtn: 'التالي: الجزء 2',
      pedagogicalSupportLabel: 'الدعم التعليمي:',
    },
    part2: {
      title: 'الجزء 2: إكمال جمل الروتين اليومي',
      instruction: 'اختر الكلمة الأنسب لإكمال كل سياق.',
      completedCount: (completed, total) => `${completed}/${total} مكتمل`,
      backBtn: '← السابق',
      nextBtn: 'التالي: الجزء 3',
      getPedagogicalHint: (word) => `تلميح: اختر "${word}" وفقاً لسياق الجملة.`,
    },
    part3: {
      title: 'الجزء 3: كتابة الجمل النشطة',
      instruction: 'اكتب جملة إنجليزية كاملة تطبق فيها كل كلمة في سياق روتينك اليومي الحقيقي.',
      getPedagogicalPrompt: (word) =>
        `اكتب جملة كاملة باللغة الإنجليزية باستخدام "${word}" في سياق روتينك اليومي أو عملك.`,
      placeholder: (word) => `اكتب جملتك بالإنجليزية باستخدام "${word}"...`,
      checkWithAi: 'تصحيح بالذكاء الاصطناعي',
      checking: 'جاري الفحص...',
      suggestionLabel: 'اقتراح:',
      greatSentence: 'جملة ممتازة!',
      backBtn: '← السابق',
      nextBtn: 'التالي: الجزء 4',
    },
    part4: {
      title: 'الجزء 4: قراءة وفهم الروتين اليومي',
      instruction: 'اقرأ النص القصير الذي يربط مفرداتك الأسبوعية وأجب عن أسئلة الفهم.',
      listenBtn: 'استمع',
      backBtn: '← السابق',
      submitBtn: 'إرسال وتصحيح',
    },
    results: {
      scoreTitle: 'درجة استيعاب المفردات',
      congrats: 'عمل رائع! لقد رسخت مفرداتك الأسبوعية في ممارسة إنجليزية حقيقية.',
      sendTutorBtn: 'إرسال للمعلم',
      printBtn: 'طباعة',
      doneBtn: 'تم وإغلاق',
      keyTitle: 'الإجابات والشرح التفصيلي',
      vocabKeyLabel: 'المفردات:',
    },
    emptyState: {
      title: 'لا توجد مفردات مسجلة هذا الأسبوع',
      description: 'أضف كلمات إلى روتينك اليومي أو احضر درساً مع معلمك لتفعيل التمارين.',
      howToTitle: 'كيفية تفعيل التمارين:',
      step1: 'أضف كلمات إلى أنشطة الروتين اليومي.',
      step2: 'احضر درساً مباشراً مع المعلم.',
      step3: 'احفظ الكلمات في قاموسك الشخصي.',
      backBtn: 'العودة إلى الروتين',
    },
    toastSubmitted: 'تم إرسال الواجب للمعلم بنجاح!',
  },

  tr: {
    modalTitle: 'Haftalık Kelime Pekiştirme Aktivitesi',
    wordsCount: (count) => `${count} Kelime`,
    scoreBadge: (score) => `%${score} Puan`,
    aiGenerateBtn: 'Yapay Zeka ile Oluştur',
    generatingAi: 'Oluşturuluyor...',
    printBtn: 'Yazdır',
    close: 'Kapat',
    weekLabelPrefix: 'Hafta:',
    tabs: {
      matching: '🔗 1. Bölüm: Eşleştirme',
      fill: '✏️ 2. Bölüm: Boşluk Doldurma',
      sentences: '✍️ 3. Bölüm: Cümle Kurma',
      reading: '📖 4. Bölüm: Kısa Hikaye',
      results: '🏆 Değerlendirme & Cevaplar',
    },
    part1: {
      title: '1. Bölüm: Kelimeleri Anlamlarıyla Eşleştirin',
      instruction: 'Her tanım için uygun kelimeyi seçin.',
      wordsBankLabel: 'Kelimeler:',
      selectPlaceholder: '-- Kelime seçin --',
      answeredCount: (answered, total) => `${answered}/${total} yanıtlandı`,
      nextBtn: 'İleri: 2. Bölüm',
      pedagogicalSupportLabel: 'Pedagojik destek:',
    },
    part2: {
      title: '2. Bölüm: Rutin Cümlelerini Tamamlayın',
      instruction: 'Her rutin bağlamını en iyi tamamlayan kelimeyi seçin.',
      completedCount: (completed, total) => `${completed}/${total} tamamlandı`,
      backBtn: '← Geri',
      nextBtn: 'İleri: 3. Bölüm',
      getPedagogicalHint: (word) => `İpucu: Bağlama uygun olarak "${word}" kelimesini seçin.`,
    },
    part3: {
      title: '3. Bölüm: Pratik Cümle Kurma',
      instruction: 'Hedef kelimeyi günlük rutininize uyarlayarak tam bir İngilizce cümle yazın.',
      getPedagogicalPrompt: (word) =>
        `Günlük rutininizde veya iş hayatınızda "${word}" kelimesini kullanarak tam bir İngilizce cümle yazın.`,
      placeholder: (word) => `"${word}" kullanarak İngilizce cümlenizi yazın...`,
      checkWithAi: 'Yapay Zeka ile Kontrol Et',
      checking: 'İnceleniyor...',
      suggestionLabel: 'Öneri:',
      greatSentence: 'Harika cümle!',
      backBtn: '← Geri',
      nextBtn: 'İleri: 4. Bölüm',
    },
    part4: {
      title: '4. Bölüm: Rutin Okuma & Anlama',
      instruction: 'Haftalık kelimelerinizi birleştiren metni okuyun ve soruları cevaplayın.',
      listenBtn: 'Dinle',
      backBtn: '← Geri',
      submitBtn: 'Gönder ve Notlandır',
    },
    results: {
      scoreTitle: 'Haftalık Pekiştirme Puanı',
      congrats: 'Tebrikler! Bu haftanın kelimelerini kalıcı İngilizce alışkanlığına dönüştürdünüz.',
      sendTutorBtn: 'Native Friend\'e Gönder',
      printBtn: 'Yazdır',
      doneBtn: 'Tamamlandı / Kapat',
      keyTitle: 'Cevap Anahtarı & Açıklamalar',
      vocabKeyLabel: 'Kelime Anahtarı:',
    },
    emptyState: {
      title: 'Bu Hafta Henüz Kelime Kaydedilmedi',
      description: 'Günlük rutinlerinize kelimeler ekleyin veya Native Friend ile derse katılın.',
      howToTitle: 'Egzersizleri başlatmak için:',
      step1: 'Günlük rutin aktivitelerinize hedef kelimeler ekleyin.',
      step2: 'Native Friend ile canlı derse katılın.',
      step3: 'Kişisel Sözlüğünüze kelimeler kaydedin.',
      backBtn: 'Rutine Dön',
    },
    toastSubmitted: 'Haftalık aktivite öğretmeninize başarıyla gönderildi!',
  },
};

export const getMemorizationTranslations = (lang: Language): MemorizationTranslations => {
  return MEMORIZATION_I18N[lang] || MEMORIZATION_I18N.en;
};
