import React, { useState, useMemo } from 'react';
import {
  X,
  BookOpen,
  Sparkles,
  Volume2,
  Calendar,
  Wand2,
  Trash2,
  Search,
  Copy,
  Check,
  Tag,
  AlertCircle,
} from 'lucide-react';
import { DailyJournalEntry, Language } from '../types';
import { speakText } from '../utils/audio';

interface StudentJournalModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: DailyJournalEntry[];
  currentLanguage: Language;
  onDeleteEntry?: (id: string) => void;
  onOpenDailySentenceSection?: () => void;
}

export const StudentJournalModal: React.FC<StudentJournalModalProps> = ({
  isOpen,
  onClose,
  entries,
  currentLanguage,
  onDeleteEntry,
  onOpenDailySentenceSection,
}) => {
  const isEn = currentLanguage === 'en';
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredEntries = useMemo(() => {
    if (!searchTerm.trim()) return entries;
    const term = searchTerm.toLowerCase().trim();
    return entries.filter((e) => {
      const inSentence = (e.sentence || '').toLowerCase().includes(term);
      const inCorrected = (e.correctedSentence || '').toLowerCase().includes(term);
      const inWords = (e.wordsUsed || []).some((w) => (w || '').toLowerCase().includes(term));
      const inDate = (e.date || '').includes(term);
      return inSentence || inCorrected || inWords || inDate;
    });
  }, [entries, searchTerm]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (dateStr: string) => {
    try {
      const [year, month, day] = dateStr.split('-');
      if (year && month && day) {
        const d = new Date(Number(year), Number(month) - 1, Number(day));
        return isEn
          ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
          : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#000035]/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div
        className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-[#607EC9]/30 overflow-hidden my-auto flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-modal-title"
      >
        {/* Header */}
        <div className="px-6 py-4.5 bg-gradient-to-r from-[#000035] via-[#062863] to-[#1C4C96] text-white flex items-center justify-between border-b border-[#1C4C96] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1C4C96] flex items-center justify-center text-[#F4CA54] shadow-xs border border-[#9AB4FF]/40">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="journal-modal-title" className="font-black text-base sm:text-lg text-white">
                  {isEn ? 'Student Journal & Saved Sentences' : 'Diário & Frases Salvas'}
                </h3>
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#F4CA54] text-[#000035]">
                  {entries.length} {isEn ? (entries.length === 1 ? 'entry' : 'entries') : (entries.length === 1 ? 'frase' : 'frases')}
                </span>
              </div>
              <p className="text-xs text-[#9AB4FF] mt-0.5">
                {isEn
                  ? 'All your daily sentences and AI corrections safely stored in your cloud profile'
                  : 'Todas as suas frases diárias e correções da IA salvas com segurança no seu perfil'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-[#1C4C96]/60 transition cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Bar */}
        <div className="px-6 py-3 bg-[#F8FAFC] border-b border-[#607EC9]/20 flex items-center gap-3 shrink-0">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#607EC9] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={
                isEn
                  ? 'Search sentences, vocabulary words, or dates...'
                  : 'Pesquisar frases, palavras da rotina ou datas...'
              }
              className="w-full pl-9 pr-4 py-2 bg-white border border-[#607EC9]/30 rounded-xl text-xs text-[#000035] focus:outline-hidden focus:ring-2 focus:ring-[#1C4C96] font-medium"
            />
          </div>
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="text-xs text-[#607EC9] hover:text-[#000035] font-bold cursor-pointer"
            >
              {isEn ? 'Clear' : 'Limpar'}
            </button>
          )}
        </div>

        {/* Entries List */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {filteredEntries.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3">
              <div className="w-14 h-14 mx-auto rounded-3xl bg-[#9AB4FF]/20 flex items-center justify-center text-[#1C4C96] border border-[#607EC9]/30">
                <BookOpen className="w-7 h-7 text-[#1C4C96]" />
              </div>
              <h4 className="text-sm sm:text-base font-bold text-[#000035]">
                {searchTerm
                  ? (isEn ? 'No sentences matched your search' : 'Nenhuma frase encontrada com este termo')
                  : (isEn ? 'Your Journal is currently empty' : 'Seu Diário ainda não possui frases salvas')}
              </h4>
              <p className="text-xs text-[#607EC9] max-w-md mx-auto leading-relaxed">
                {searchTerm
                  ? (isEn ? 'Try adjusting your search query.' : 'Tente pesquisar por outra palavra ou data.')
                  : (isEn
                      ? 'Write your daily English sentence in the "Sentence of the Day" section to record vocabulary and receive pedagogical AI feedback.'
                      : 'Escreva sua frase do dia na seção "Frase do Dia" para praticar o vocabulário diário e salvar as correções pedagógicas.')}
              </p>
              {onOpenDailySentenceSection && !searchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenDailySentenceSection();
                  }}
                  className="mt-2 px-4 py-2 bg-[#062863] hover:bg-[#000035] text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#F4CA54]" />
                  <span>{isEn ? 'Go to Sentence of the Day' : 'Ir para a Frase do Dia'}</span>
                </button>
              )}
            </div>
          ) : (
            filteredEntries.map((entry) => {
              const hasAiCorrection = Boolean(entry.correctedSentence && entry.correctedSentence !== entry.sentence);
              return (
                <div
                  key={entry.id}
                  className="bg-white rounded-2xl p-4 sm:p-5 border border-[#607EC9]/30 shadow-xs space-y-3 hover:border-[#1C4C96]/50 transition"
                >
                  {/* Top Bar: Date & Actions */}
                  <div className="flex items-center justify-between gap-2 border-b border-[#9AB4FF]/20 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-[#1C4C96]" />
                      <span className="text-xs font-black text-[#000035]">
                        {formatDate(entry.date)}
                      </span>
                      {entry.createdAt && (
                        <span className="text-[10px] text-[#607EC9] font-mono">
                          {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleCopy(entry.id, entry.correctedSentence || entry.sentence)}
                        className="p-1.5 rounded-lg text-[#607EC9] hover:text-[#000035] hover:bg-[#9AB4FF]/15 transition cursor-pointer"
                        title={isEn ? 'Copy sentence' : 'Copiar frase'}
                      >
                        {copiedId === entry.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {onDeleteEntry && (
                        <button
                          type="button"
                          onClick={() => onDeleteEntry(entry.id)}
                          className="p-1.5 rounded-lg text-[#607EC9] hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                          title={isEn ? 'Delete from journal' : 'Excluir do diário'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Student Original Sentence */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-[#062863] uppercase tracking-wider flex items-center gap-1">
                        <span>{isEn ? 'Your Sentence:' : 'Sua Frase:'}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => speakText(entry.sentence)}
                        className="text-[#1C4C96] hover:text-[#000035] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        title={isEn ? 'Listen to sentence' : 'Ouvir pronúncia'}
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>{isEn ? 'Listen' : 'Ouvir'}</span>
                      </button>
                    </div>
                    <p className="text-xs sm:text-sm text-[#000035] font-medium leading-relaxed bg-[#F8FAFC] p-3 rounded-xl border border-[#607EC9]/20">
                      "{entry.sentence}"
                    </p>
                  </div>

                  {/* AI Corrected Polish Version (if available) */}
                  {hasAiCorrection && (
                    <div className="bg-[#EFF6FF] rounded-xl p-3.5 border border-[#9AB4FF]/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-[#1C4C96] uppercase tracking-wider flex items-center gap-1.5">
                          <Wand2 className="w-3 h-3 text-[#1C4C96]" />
                          <span>{isEn ? 'AI Pedagogical Polish:' : 'Versão Aperfeiçoada pela IA:'}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => speakText(entry.correctedSentence!)}
                          className="text-[#1C4C96] hover:text-[#000035] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          title={isEn ? 'Listen to corrected sentence' : 'Ouvir pronúncia da correção'}
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Listen' : 'Ouvir'}</span>
                        </button>
                      </div>
                      <p className="text-xs sm:text-sm font-bold text-[#062863] leading-relaxed">
                        "{entry.correctedSentence}"
                      </p>
                      {entry.explanation && (
                        <p className="text-[11px] text-[#1C4C96] bg-white/80 p-2 rounded-lg leading-relaxed flex items-start gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#1C4C96]" />
                          <span>{entry.explanation}</span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Words Used Chips */}
                  {entry.wordsUsed && entry.wordsUsed.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      <span className="text-[10px] font-bold text-[#607EC9] flex items-center gap-1 mr-1">
                        <Tag className="w-3 h-3" />
                        <span>{isEn ? 'Words included:' : 'Palavras incluídas:'}</span>
                      </span>
                      {entry.wordsUsed.map((word, wIdx) => (
                        <span
                          key={wIdx}
                          className="px-2 py-0.5 rounded-lg bg-[#9AB4FF]/20 text-[#062863] text-[10px] font-bold border border-[#9AB4FF]/50"
                        >
                          {word}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[#F8FAFC] border-t border-[#607EC9]/20 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-[#607EC9] font-medium">
            {isEn ? 'Cloud Synced with Firebase' : 'Sincronizado na Nuvem com o Firebase'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-[#062863] hover:bg-[#000035] text-white rounded-xl text-xs font-bold transition cursor-pointer"
          >
            {isEn ? 'Close' : 'Fechar'}
          </button>
        </div>
      </div>
    </div>
  );
};
