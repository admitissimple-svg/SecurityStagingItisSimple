import React from 'react';
import {
  PenTool,
  Sparkles,
  Clock,
  Wand2,
  Save,
  Check,
  Loader2,
  AlertTriangle,
  Volume2,
  CheckCircle2,
  X,
} from 'lucide-react';
import { WritingEvaluationResult } from '../types';

interface StudentDailySentenceCardProps {
  isEn: boolean;
  reminderTime: string;
  displayRoutineWords: string[];
  matchedSentenceWords: string[];
  sentenceInput: string;
  sentenceSavedSuccess: boolean;
  isCheckingSentence: boolean;
  sentenceEvaluation: WritingEvaluationResult | null;
  onOpenJournalModal?: () => void;
  onTest30MinReminder?: () => void;
  setSentenceInput: React.Dispatch<React.SetStateAction<string>>;
  setSentenceEvaluation: React.Dispatch<React.SetStateAction<WritingEvaluationResult | null>>;
  handleApplySentenceCorrection: () => void;
  handleCheckGrammar: () => void;
  handleSaveSentence: (e?: React.FormEvent) => void;
  speakText: (text: string) => void;
}

export const StudentDailySentenceCard: React.FC<StudentDailySentenceCardProps> = ({
  isEn,
  reminderTime,
  displayRoutineWords,
  matchedSentenceWords,
  sentenceInput,
  sentenceSavedSuccess,
  isCheckingSentence,
  sentenceEvaluation,
  onOpenJournalModal,
  onTest30MinReminder,
  setSentenceInput,
  setSentenceEvaluation,
  handleApplySentenceCorrection,
  handleCheckGrammar,
  handleSaveSentence,
  speakText,
}) => {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#9AB4FF]/30 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#9AB4FF]/20 text-[#062863] flex items-center justify-center shrink-0 border border-[#9AB4FF]/40">
            <PenTool className="w-4 h-4 text-[#1C4C96]" />
          </div>
          <div className="flex items-center gap-1.5">
            <h3 className="font-black text-xs text-[#000035] tracking-tight">
              {isEn ? 'Sentence of the Day' : 'Frase do Dia'}
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#9AB4FF]/20 text-[#062863] border border-[#9AB4FF]/40">
              {isEn ? 'Daily Wrap-up' : 'Encerramento'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onOpenJournalModal && (
            <button
              type="button"
              onClick={onOpenJournalModal}
              className="px-2.5 py-1 bg-[#062863] hover:bg-[#000035] text-white border border-[#1C4C96] rounded-xl text-[10px] font-bold flex items-center gap-1 transition cursor-pointer self-start sm:self-auto shadow-xs"
              title={isEn ? 'View saved sentences & journal' : 'Ver diário de frases salvas'}
            >
              <Sparkles className="w-3 h-3 text-[#F4CA54]" />
              <span>{isEn ? 'View Journal' : 'Ver Diário'}</span>
            </button>
          )}

          {onTest30MinReminder && (
            <button
              type="button"
              onClick={onTest30MinReminder}
              className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-[10px] font-bold flex items-center gap-1 transition cursor-pointer self-start sm:self-auto"
            >
              <Clock className="w-3 h-3 text-amber-600" />
              <span>
                {isEn ? `Test 30-min reminder (${reminderTime})` : `Testar lembrete (${reminderTime})`}
              </span>
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-[#607EC9] leading-relaxed">
        {isEn
          ? 'Create a meaningful English sentence connecting your routine moments and the words you recorded today.'
          : 'Crie uma frase em inglês conectando os momentos da sua rotina e as palavras que você registrou hoje.'}
      </p>

      {/* Routine Words Chips */}
      <div className="p-2.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
        <span className="text-[10px] font-bold text-[#607EC9] block">
          {isEn ? "Today's Routine Words to include:" : 'Palavras da rotina de hoje para incluir:'}{' '}
          <span className="text-[#000035] font-black">
            ({matchedSentenceWords.length}/{displayRoutineWords.length} used)
          </span>
        </span>
        <div className="flex flex-wrap gap-1">
          {displayRoutineWords.length === 0 ? (
            <span className="text-[11px] text-slate-400 italic">
              {isEn
                ? 'No routine words recorded yet. Type your 5 keywords on the panel below!'
                : 'Nenhuma palavra registrada ainda. Digite suas 5 palavras-chave no painel abaixo!'}
            </span>
          ) : (
            displayRoutineWords.map((word) => {
              const isUsed = (sentenceInput || '')
                .toLowerCase()
                .includes(word.toLowerCase());
              return (
                <button
                  key={word}
                  type="button"
                  onClick={() => {
                    setSentenceInput((prev) => {
                      const trimmed = prev.trim();
                      return trimmed ? `${trimmed} ${word}` : word;
                    });
                    if (sentenceEvaluation) setSentenceEvaluation(null);
                  }}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition cursor-pointer ${
                    isUsed
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                      : 'bg-white text-[#062863] border-[#9AB4FF]/50 hover:border-[#1C4C96]'
                  }`}
                  title={isEn ? 'Click to insert word' : 'Clique para inserir a palavra'}
                >
                  {word}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Sentence Textarea */}
      <form onSubmit={handleSaveSentence}>
        <textarea
          value={sentenceInput}
          onChange={(e) => {
            setSentenceInput(e.target.value);
            if (sentenceEvaluation) setSentenceEvaluation(null);
          }}
          rows={2}
          placeholder={
            isEn
              ? 'Your Daily English Sentence: e.g., Today I had my morning coffee at 7:30, caught the bus, and worked on my English goals...'
              : 'Sua Frase do Dia em Inglês: ex: Today I had my morning coffee at 7:30, caught the bus, and worked on my English goals...'
          }
          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-[#000035] focus:outline-none focus:ring-1 focus:ring-[#1C4C96] placeholder:text-slate-400 placeholder:font-normal"
        />
      </form>

      {/* AI Grammar Analysis Result Card */}
      {sentenceEvaluation && (
        <div className="animate-in fade-in duration-200">
          {sentenceEvaluation.hasAnyError ||
          sentenceEvaluation.isCorrect === false ||
          (sentenceEvaluation.correctedSentence &&
            sentenceEvaluation.correctedSentence.trim().replace(/[.!?]+$/, '') !==
              sentenceInput.trim().replace(/[.!?]+$/, '')) ? (
            <div className="p-3.5 bg-gradient-to-br from-[#FFF8F6] to-white rounded-2xl border-2 border-rose-200 shadow-xs space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200">
                    <AlertTriangle className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-xs font-extrabold text-rose-900">
                        {isEn ? 'AI Grammar Analysis & Feedback' : 'Correção Gramatical da IA'}
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                        {isEn ? 'Improvement' : 'Melhoria'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {sentenceEvaluation.correctedSentence && (
                    <button
                      type="button"
                      onClick={handleApplySentenceCorrection}
                      className="px-2 py-1 bg-[#1C4C96] hover:bg-[#062863] text-white text-[10px] font-bold rounded-xl transition flex items-center gap-1 shadow-xs cursor-pointer"
                      title={isEn ? 'Replace textarea with this corrected version' : 'Usar versão corrigida no campo'}
                    >
                      <Wand2 className="w-3 h-3 text-[#F4CA54]" />
                      <span>{isEn ? 'Apply & Use' : 'Aplicar Frase'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSentenceEvaluation(null)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                    title={isEn ? 'Dismiss' : 'Fechar'}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {sentenceEvaluation.correctedSentence && (
                <div className="p-2.5 bg-white rounded-xl border border-rose-200 space-y-1 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-rose-900 uppercase tracking-wider block">
                      {isEn ? '✨ Suggested Natural Version:' : '✨ Versão Natural Sugerida:'}
                    </span>
                    <button
                      type="button"
                      onClick={() => speakText(sentenceEvaluation.correctedSentence || '')}
                      className="text-[#1C4C96] hover:text-[#062863] text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>{isEn ? 'Listen' : 'Ouvir'}</span>
                    </button>
                  </div>
                  <p className="text-xs font-bold text-[#000035] leading-relaxed">
                    "{sentenceEvaluation.correctedSentence}"
                  </p>
                </div>
              )}

              {/* Word-level highlights */}
              {sentenceEvaluation.wordFeedbacks && sentenceEvaluation.wordFeedbacks.some((wf) => wf.hasError) && (
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-600 block">
                    {isEn ? 'Target adjustments:' : 'Ajustes identificados:'}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {sentenceEvaluation.wordFeedbacks.filter((wf) => wf.hasError).map((wf, i) => (
                      <span
                        key={i}
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white border border-rose-300 text-rose-900 font-bold"
                      >
                        <span className="line-through text-rose-400">{wf.original}</span> → <span className="text-emerald-700">{wf.corrected}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Explanation */}
              {(sentenceEvaluation.sentenceFeedback?.explanationPt ||
                sentenceEvaluation.sentenceFeedback?.explanationEn ||
                sentenceEvaluation.explanation ||
                sentenceEvaluation.overallSummaryPt ||
                sentenceEvaluation.overallSummaryEn) && (
                <p className="text-[11px] text-rose-900 bg-rose-50/80 p-2 rounded-xl leading-relaxed border border-rose-100">
                  💡 <span className="font-semibold">{isEn ? 'Explanation:' : 'Explicação:'}</span>{' '}
                  {isEn
                    ? (sentenceEvaluation.sentenceFeedback?.explanationEn || sentenceEvaluation.overallSummaryEn || sentenceEvaluation.explanation)
                    : (sentenceEvaluation.sentenceFeedback?.explanationPt || sentenceEvaluation.overallSummaryPt || sentenceEvaluation.explanation)}
                </p>
              )}
            </div>
          ) : (
            <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 text-emerald-900 flex items-center justify-between gap-2 text-xs shadow-2xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-bold">
                  {isEn
                    ? '✨ Outstanding! Your sentence is grammatically correct and natural.'
                    : '✨ Excelente! Sua frase está gramaticalmente correta e natural.'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSentenceEvaluation(null)}
                className="text-emerald-700 hover:text-emerald-900 text-[10px] font-bold px-2 py-0.5 rounded-md hover:bg-emerald-100 cursor-pointer"
              >
                OK
              </button>
            </div>
          )}
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2.5 border-t border-[#9AB4FF]/25">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[#607EC9]">
            {sentenceInput.trim().split(/\s+/).filter(Boolean).length}{' '}
            {isEn ? 'words' : 'palavras'}
          </span>
          {sentenceSavedSuccess && (
            <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              {isEn ? 'Saved to your journal!' : 'Salvo no seu diário!'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCheckGrammar}
            disabled={!sentenceInput.trim() || isCheckingSentence}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-[#000035] rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer border border-slate-300 disabled:opacity-50"
          >
            {isCheckingSentence ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1C4C96]" />
                <span>{isEn ? 'Checking...' : 'Verificando...'}</span>
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5 text-[#1C4C96]" />
                <span>{isEn ? 'Check Grammar' : 'Verificar Gramática'}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSaveSentence}
            disabled={!sentenceInput.trim() || isCheckingSentence}
            className="px-4 py-1.5 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl text-[11px] font-black flex items-center gap-1.5 transition cursor-pointer shadow-2xs border border-[#9AB4FF]/40 disabled:opacity-50"
          >
            <Save className="w-3 h-3" />
            <span>{isEn ? 'Save Sentence' : 'Salvar Frase'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
