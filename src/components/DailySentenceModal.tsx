import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Volume2,
  Check,
  Send,
  PenTool,
  Wand2,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  Loader2,
} from 'lucide-react';
import { RoutineItem, UserProfile, WritingEvaluationResult, Language } from '../types';
import { checkDailySentenceAi } from '../utils/writingChecker';
import { speakText } from '../utils/audio';

interface DailySentenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  todayRoutines: RoutineItem[];
  userProfile: UserProfile;
  currentLanguage: Language;
  onSaveDailySentence: (sentence: string, wordsUsed: string[], evaluationResult?: WritingEvaluationResult | null) => void;
  onOpenJournalModal?: () => void;
}

export const DailySentenceModal: React.FC<DailySentenceModalProps> = ({
  isOpen,
  onClose,
  todayRoutines,
  userProfile,
  currentLanguage,
  onSaveDailySentence,
  onOpenJournalModal,
}) => {
  const isEn = currentLanguage === 'en';
  const [sentenceInput, setSentenceInput] = useState<string>('');
  const [evaluation, setEvaluation] = useState<WritingEvaluationResult | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Gather all unique words
  const allWords: string[] = [];
  (todayRoutines || []).forEach((item) => {
    if (item && item.learnedWords && Array.isArray(item.learnedWords)) {
      item.learnedWords.forEach((w) => {
        const trimmed = (w || '').trim();
        if (trimmed && !allWords.includes(trimmed)) {
          allWords.push(trimmed);
        }
      });
    }
  });

  const matchedWords = allWords.filter((w) =>
    sentenceInput.toLowerCase().includes(w.toLowerCase())
  );

  const handleManualCheck = async () => {
    if (!sentenceInput.trim() || sentenceInput.trim().length < 4) return;
    setIsChecking(true);
    try {
      const result = await checkDailySentenceAi(
        sentenceInput.trim(),
        allWords
      );
      setEvaluation(result);
    } catch {
      // API has fallback
    } finally {
      setIsChecking(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sentenceInput.trim();
    if (!clean || clean.length < 4) return;

    let activeEval = evaluation;
    if (!activeEval) {
      setIsChecking(true);
      try {
        activeEval = await checkDailySentenceAi(clean, allWords);
        setEvaluation(activeEval);
      } catch {
        // API has fallback
      } finally {
        setIsChecking(false);
      }

      if (
        activeEval &&
        (activeEval.hasAnyError ||
          activeEval.isCorrect === false ||
          (activeEval.correctedSentence && activeEval.correctedSentence.trim() !== clean))
      ) {
        return;
      }
    }

    const wordsToRecord = matchedWords.length > 0 ? matchedWords : (activeEval?.usedWords || allWords);
    onSaveDailySentence(clean, wordsToRecord, activeEval);
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 1200);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#000035]/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-[#607EC9]/30 overflow-hidden my-auto">
        {/* Header */}
        <div className="px-6 py-4 bg-[#000035] text-white flex items-center justify-between border-b border-[#1C4C96]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1C4C96] flex items-center justify-center text-white shadow-xs border border-[#9AB4FF]/40">
              <PenTool className="w-5 h-5 text-[#9AB4FF]" />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-white">
                {isEn ? 'End of Day Sentence Review' : 'Revisão da Frase do Dia'}
              </h3>
              <p className="text-xs text-[#9AB4FF]">
                {isEn ? 'Consolidate today’s vocabulary into a coherent sentence' : 'Conecte as palavras praticadas hoje numa frase'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenJournalModal && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenJournalModal();
                }}
                className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-[#F4CA54] text-xs font-bold border border-[#9AB4FF]/30 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                title={isEn ? 'View Journal' : 'Ver Diário'}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isEn ? 'Journal' : 'Diário'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-[#1C4C96] transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="p-6 space-y-4">
          {saveSuccess && (
            <div className="p-3 bg-[#9AB4FF]/20 border border-[#607EC9] rounded-2xl text-xs font-bold text-[#062863] flex items-center gap-2">
              <Check className="w-4 h-4 text-[#1C4C96]" />
              <span>{isEn ? 'Saved to journal!' : 'Frase salva no seu diário com sucesso!'}</span>
            </div>
          )}

          {/* Words */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold text-[#000035] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#1C4C96]" />
              <span>{isEn ? 'Words Learned Today:' : 'Palavras Praticadas Hoje:'}</span>
            </span>

            <div className="flex flex-wrap gap-1.5">
              {allWords.map((w, idx) => {
                const isUsed = matchedWords.includes(w);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSentenceInput((prev) => (prev ? `${prev} ${w}` : w))}
                    className={`px-2.5 py-1 rounded-xl text-xs font-bold transition border cursor-pointer ${
                      isUsed
                        ? 'bg-[#9AB4FF]/25 text-[#062863] border-[#607EC9]'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-[#1C4C96]'
                    }`}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Textarea */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#000035]">
                {isEn ? 'Your Sentence in English:' : 'Sua Frase em Inglês:'}
              </label>
              {sentenceInput.trim() && (
                <button
                  type="button"
                  onClick={() => speakText(sentenceInput)}
                  className="text-xs text-[#1C4C96] hover:text-[#062863] flex items-center gap-1 font-bold"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Listen' : 'Ouvir'}</span>
                </button>
              )}
            </div>

            <textarea
              rows={3}
              required
              value={sentenceInput}
              onChange={(e) => {
                setSentenceInput(e.target.value);
                setEvaluation(null);
              }}
              placeholder={
                isEn
                  ? 'Write your daily reflection using today’s vocabulary...'
                  : 'Escreva seu resumo diário em inglês usando as palavras do dia...'
              }
              className="w-full p-3 bg-white border border-[#607EC9]/40 rounded-xl text-xs sm:text-sm text-[#000035] focus:ring-2 focus:ring-[#1C4C96] resize-none"
            />
          </div>

          {/* AI Feedback */}
          {evaluation && (
            (evaluation.hasAnyError || !evaluation.isCorrect || (evaluation.correctedSentence && evaluation.correctedSentence.trim() !== sentenceInput.trim())) ? (
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs space-y-2 text-amber-900 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-amber-950">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>{isEn ? 'Correction Suggestion:' : 'Sugestão de Correção:'}</span>
                  </div>
                  {evaluation.correctedSentence && (
                    <button
                      type="button"
                      onClick={() => {
                        const corrected = evaluation.correctedSentence || '';
                        setSentenceInput(corrected);
                        setEvaluation((prev) =>
                          prev
                            ? {
                                ...prev,
                                hasAnyError: false,
                                isCorrect: true,
                                correctedSentence: corrected,
                              }
                            : null
                        );
                      }}
                      className="px-2.5 py-1 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-lg font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                    >
                      <Wand2 className="w-3 h-3 text-[#F4CA54]" />
                      <span>{isEn ? 'Apply Suggestion' : 'Aplicar Sugestão'}</span>
                    </button>
                  )}
                </div>
                {evaluation.correctedSentence && (
                  <div className="p-2 bg-white/70 rounded-lg border border-amber-200/60 flex items-center justify-between gap-2">
                    <p className="font-bold text-slate-900">
                      "{evaluation.correctedSentence}"
                    </p>
                    <button
                      type="button"
                      onClick={() => speakText(evaluation.correctedSentence || '')}
                      className="text-[#1C4C96] hover:text-[#062863] text-[10px] font-bold flex items-center gap-0.5 shrink-0"
                      title={isEn ? 'Listen' : 'Ouvir'}
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>{isEn ? 'Listen' : 'Ouvir'}</span>
                    </button>
                  </div>
                )}

                {/* Word adjustments */}
                {evaluation.wordFeedbacks && evaluation.wordFeedbacks.some((wf) => wf.hasError) && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {evaluation.wordFeedbacks.filter((wf) => wf.hasError).map((wf, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white border border-amber-300 text-amber-950 font-bold"
                        title={isEn ? wf.explanationEn : wf.explanationPt}
                      >
                        <span className="line-through text-rose-400">{wf.original}</span> → <span className="text-emerald-700">{wf.corrected}</span>
                      </span>
                    ))}
                  </div>
                )}

                {evaluation.targetWordFeedback && (
                  <p className="text-[11px] text-amber-950 bg-white/70 p-2 rounded-lg border border-amber-200/60 leading-relaxed">
                    🎯 <span className="font-semibold">{isEn ? 'Vocabulary Requirement:' : 'Vocabulário da Rotina:'}</span>{' '}
                    {evaluation.targetWordFeedback}
                  </p>
                )}

                {evaluation.explanation && <p className="text-[11px] leading-relaxed">{evaluation.explanation}</p>}

                {(evaluation.levelTipsPt || evaluation.levelTipsEn) && (
                  <div className="text-[10px] text-[#062863] bg-[#9AB4FF]/20 p-2 rounded-lg border border-[#607EC9]/30 flex items-center gap-1.5 font-medium">
                    <Sparkles className="w-3 h-3 text-[#1C4C96] shrink-0" />
                    <span>{isEn ? evaluation.levelTipsEn : evaluation.levelTipsPt}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2 animate-in fade-in">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <span className="font-bold block">
                      {isEn ? '✨ Your sentence looks great and grammatically sound!' : '✨ Sua frase está ótima e gramaticalmente correta!'}
                    </span>
                    {(evaluation.targetWordFeedback || evaluation.overallSummaryEn || evaluation.overallSummaryPt) && (
                      <span className="text-[11px] text-emerald-800 block mt-0.5">
                        {evaluation.targetWordFeedback || (isEn ? evaluation.overallSummaryEn : evaluation.overallSummaryPt)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          )}

          <div className="pt-2 flex justify-between items-center border-t border-slate-100">
            <button
              type="button"
              onClick={handleManualCheck}
              disabled={!sentenceInput.trim() || isChecking}
              className="px-3 py-2 bg-white hover:bg-[#9AB4FF]/15 border border-[#607EC9]/40 rounded-xl text-xs font-bold text-[#062863] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isChecking ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1C4C96]" />
                  <span>{isEn ? 'Checking...' : 'Analisando...'}</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-3.5 h-3.5 text-[#1C4C96]" />
                  <span>{isEn ? 'Check with AI' : 'Verificar com IA'}</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold"
              >
                {isEn ? 'Close' : 'Fechar'}
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isEn ? 'Save to Journal' : 'Salvar no Diário'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
