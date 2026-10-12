import React, { useState } from 'react';
import {
  BookOpen,
  Volume2,
  CheckCircle2,
  Save,
  Check,
  Sparkles,
} from 'lucide-react';
import { getInstantOrCachedWord, DictionaryLookupResult } from '../utils/dictionaryService';

interface StudentKeyWordsCardProps {
  isEn: boolean;
  words: string[];
  wordDefinitions: Record<number, DictionaryLookupResult | null>;
  wordsSaveFeedback: boolean;
  handleWordChange: (idx: number, val: string) => void;
  handleSaveWords: (e?: React.FormEvent) => void;
  speakText: (text: string) => void;
  studentLevel?: string;
}

export const StudentKeyWordsCard: React.FC<StudentKeyWordsCardProps> = ({
  isEn,
  words,
  wordDefinitions,
  wordsSaveFeedback,
  handleWordChange,
  handleSaveWords,
  speakText,
  studentLevel,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className="bg-white rounded-3xl p-5 border border-[#607EC9]/30 shadow-xs space-y-4 flex flex-col justify-between h-full">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#9AB4FF]/30 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#000035] text-white flex items-center justify-center shrink-0 shadow-2xs">
              <BookOpen className="w-4 h-4 text-[#9AB4FF]" />
            </div>
            <div>
              <h3 className="font-black text-xs text-[#000035] tracking-tight">
                {isEn ? '5 Key Words for this Moment' : '5 Palavras-Chave para este Momento'}
              </h3>
              <span className="text-[10px] text-purple-700 font-semibold flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                <span>{isEn ? 'Native Friend Notes Standard' : 'Padrão Native Friend Notes'}</span>
              </span>
            </div>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#9AB4FF]/20 text-[#062863] border border-[#9AB4FF]/40">
            {words.filter((w) => w.trim().length > 0).length}/5 {isEn ? 'recorded' : 'anotadas'}
          </span>
        </div>

        <p className="text-xs text-[#607EC9] mt-2 leading-relaxed">
          {isEn
            ? 'Record 5 English words or expressions for this moment. Definitions, CEFR levels, and authentic real examples follow the Native Friend Notes standard.'
            : 'Anote 5 palavras ou expressões em inglês para este momento. Definições, nível CEFR, classe gramatical e exemplos reais seguem o padrão Native Friend Notes.'}
        </p>

        {/* 5 Input Fields */}
        <form onSubmit={handleSaveWords} className="space-y-2 mt-3">
          {words.map((w, idx) => {
            const cleanWord = w.trim();
            const def = cleanWord
              ? wordDefinitions[idx] || getInstantOrCachedWord(cleanWord, undefined, studentLevel)
              : null;

            const isHovered = hoveredIdx === idx && Boolean(cleanWord && def && def.definitionEn);

            return (
              <div
                key={idx}
                className={`flex items-center gap-2 p-1.5 rounded-2xl bg-slate-50 border border-slate-200 focus-within:border-[#1C4C96] focus-within:ring-1 focus-within:ring-[#1C4C96] transition relative ${
                  isHovered ? 'z-30 ring-1 ring-[#1C4C96]/30 bg-slate-100/80' : 'z-10'
                }`}
              >
                <span className="w-6 h-6 rounded-lg bg-[#000035] text-[#9AB4FF] text-[10px] font-black flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>

                {/* Word Input */}
                <input
                  type="text"
                  value={w}
                  onChange={(e) => handleWordChange(idx, e.target.value)}
                  placeholder={
                    isEn
                      ? `Word ${idx + 1}`
                      : `Palavra ${idx + 1}`
                  }
                  className="w-24 sm:w-28 md:w-32 shrink-0 text-xs font-bold text-[#000035] bg-transparent focus:outline-none placeholder:text-slate-400"
                />

                {/* Divider */}
                <div className="w-px h-4 bg-slate-300/80 shrink-0" />

                {/* English Description adhering to Native Friend Notes standard with Temporary Hover Expansion */}
                {cleanWord && def ? (
                  <div
                    className="relative flex-1 min-w-0"
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx((prev) => (prev === idx ? null : prev))}
                  >
                    {/* Collapsed view (clean single-line with hover affordance) */}
                    <div
                      className={`flex items-center gap-1.5 overflow-hidden rounded-xl px-1.5 py-0.5 transition-colors cursor-pointer select-none ${
                        isHovered ? 'bg-[#9AB4FF]/20' : 'hover:bg-[#9AB4FF]/10'
                      }`}
                      onClick={() => setHoveredIdx((prev) => (prev === idx ? null : idx))}
                      title={
                        isEn
                          ? 'Hover or click to view full definition and example'
                          : 'Passe o mouse ou clique para ver definição completa e exemplos'
                      }
                    >
                      {def.notFound ? (
                        <span className="text-xs text-amber-600 font-medium italic truncate flex items-center gap-1">
                          <span className="text-xs">⚠️</span>
                          <span>{isEn ? 'Word not found in standard dictionary.' : 'Palavra não localizada no dicionário padrão.'}</span>
                        </span>
                      ) : def.definitionEn ? (
                        <>
                          {/* CEFR Level Badge (Native Friend Notes Standard) */}
                          {def.cefrLevel && (
                            <span className="text-[9px] font-black text-white bg-[#000035] px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 select-none shadow-2xs">
                              {def.cefrLevel}
                            </span>
                          )}
                          {/* Grammatical Class (Part of Speech) Badge */}
                          {def.partOfSpeech && (
                            <span className="text-[9px] font-bold text-[#1C4C96] bg-[#9AB4FF]/20 border border-[#9AB4FF]/40 px-1 py-0.2 rounded uppercase tracking-wider shrink-0 select-none">
                              {def.partOfSpeech.split('/')[0].trim()}
                            </span>
                          )}
                          <span className="text-xs text-slate-700 truncate font-normal leading-tight">
                            {def.definitionEn}
                          </span>
                          {def.exampleSentenceEn && (
                            <span className="text-[11px] text-slate-500 italic truncate font-normal hidden md:inline">
                              — "{def.exampleSentenceEn}"
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px] text-purple-700 italic truncate select-none flex items-center gap-1.5 animate-pulse">
                          <Sparkles className="w-3 h-3 text-purple-600 shrink-0" />
                          <span>{isEn ? 'AI personalizing definition & real examples...' : 'AI personalizando definição e exemplos reais...'}</span>
                        </span>
                      )}
                    </div>

                    {/* Temporarily Expanded Box on Hover (Padrão Native Friend Notes) */}
                    {isHovered && def.definitionEn && (
                      <div
                        className={`absolute left-0 z-50 w-full min-w-[280px] sm:min-w-[360px] md:min-w-[420px] max-w-lg bg-white rounded-2xl p-3.5 shadow-2xl border-2 border-[#1C4C96]/40 pointer-events-auto transition-all animate-in fade-in zoom-in-95 duration-150 ${
                          idx >= 3 ? 'bottom-0' : 'top-0'
                        }`}
                        style={{
                          boxShadow: '0 20px 30px -10px rgba(0, 0, 53, 0.25), 0 10px 15px -5px rgba(28, 76, 150, 0.15)',
                        }}
                        onMouseEnter={() => setHoveredIdx(idx)}
                        onMouseLeave={() => setHoveredIdx((prev) => (prev === idx ? null : prev))}
                      >
                        {/* Header with Word, CEFR, Part of Speech, and Pronunciation */}
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 mb-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-xs text-[#000035] tracking-tight mr-1">
                              {cleanWord}
                            </span>
                            {def.cefrLevel && (
                              <span className="text-[9px] font-black text-white bg-[#000035] px-1.5 py-0.5 rounded uppercase tracking-wider shadow-2xs">
                                {def.cefrLevel}
                              </span>
                            )}
                            {def.partOfSpeech && (
                              <span className="text-[9px] font-bold text-[#1C4C96] bg-[#9AB4FF]/20 border border-[#9AB4FF]/40 px-1.5 py-0.5 rounded uppercase tracking-wider">
                                {def.partOfSpeech}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                speakText(cleanWord);
                              }}
                              className="p-1 text-[#1C4C96] hover:bg-[#9AB4FF]/20 rounded-lg transition cursor-pointer"
                              title={isEn ? 'Listen to word pronunciation' : 'Ouvir pronúncia da palavra'}
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-[9px] text-purple-700 font-semibold flex items-center gap-1 bg-purple-50 px-1.5 py-0.5 rounded-md border border-purple-200/60">
                              <Sparkles className="w-2.5 h-2.5 text-purple-600" />
                              <span>Native Friend Notes</span>
                            </span>
                          </div>
                        </div>

                        {/* Full English Definition */}
                        <div className="text-xs text-[#000035] leading-relaxed font-medium">
                          {def.definitionEn}
                        </div>

                        {/* Full Authentic Example Sentence */}
                        {def.exampleSentenceEn && (
                          <div className="mt-2.5 p-2.5 rounded-xl bg-[#9AB4FF]/10 border border-[#607EC9]/30 text-xs text-[#062863] italic leading-relaxed flex items-start gap-1.5">
                            <span className="font-bold text-[#1C4C96] not-italic shrink-0 text-[11px] uppercase tracking-wide">
                              {isEn ? 'Example:' : 'Exemplo:'}
                            </span>
                            <span>"{def.exampleSentenceEn}"</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 min-w-0 flex items-center overflow-hidden">
                    <span className="text-[11px] text-slate-400 italic truncate select-none">
                      {isEn ? 'Native Friend Notes standard definition...' : 'Definição padrão Native Friend Notes...'}
                    </span>
                  </div>
                )}

                {/* Audio pronunciation & completion mark */}
                <div className="flex items-center gap-1 shrink-0 ml-auto">
                  {cleanWord.length > 0 && (
                    <button
                      type="button"
                      onClick={() => speakText(cleanWord)}
                      className="p-1 text-[#1C4C96] hover:bg-[#9AB4FF]/20 rounded-lg transition cursor-pointer shrink-0"
                      title={isEn ? 'Listen to pronunciation' : 'Ouvir pronúncia'}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {cleanWord.length > 0 && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mr-1" />
                  )}
                </div>
              </div>
            );
          })}
        </form>
      </div>

      {/* Footer Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-[#9AB4FF]/30">
        <div>
          {wordsSaveFeedback && (
            <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              {isEn ? '5 Words saved successfully!' : '5 Palavras salvas com sucesso!'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSaveWords}
            className="px-4 py-1.5 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl text-[11px] font-black flex items-center gap-1.5 transition cursor-pointer shadow-2xs border border-[#9AB4FF]/40"
          >
            <Save className="w-3 h-3" />
            <span>{isEn ? 'Save 5 Words' : 'Salvar 5 Palavras'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
