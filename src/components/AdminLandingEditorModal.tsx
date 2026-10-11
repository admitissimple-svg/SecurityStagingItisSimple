import React, { useState } from 'react';
import {
  X,
  Edit3,
  Save,
  Check,
  Sparkles,
  Layout,
  BookOpen,
  MessageSquare,
  Globe,
  RotateCcw,
} from 'lucide-react';
import { AdminLandingContent, Language } from '../types';

export const DEFAULT_ADMIN_LANDING_CONTENT: AdminLandingContent = {
  heroBadge: 'Uma Nova Filosofia de Inglês',
  heroHeadlineStart: 'Learn English by',
  heroHeadlineHighlight: 'Living your Life',
  heroQuote: '“Você não precisa estudar mais. Você pode viver em inglês.”',
  heroSubtext: 'Transforme sua rotina diária em prática real. Do café da manhã ao trabalho e descanso noturno. Sua vida. Seu inglês. Do seu jeito.',
  heroFindFriendBtn: 'Encontre Seu Amigo Nativo',
  heroStartLivingBtn: 'Comece a Viver em Inglês',
  philosophyBadge: 'A Ciência do Hábito',
  philosophyHeading1: 'Não mude sua rotina.',
  philosophyHeading2: 'Viva-a em Inglês.',
  philosophySubheading: 'Aprender inglês não precisa ser uma tarefa pesada de 2 horas em uma sala de aula após um longo dia de trabalho. Conectamos seu aprendizado com o que você já faz todos os dias.',
  philosophyPillar1Title: 'Prática Integrada à Sua Vida',
  philosophyPillar1Desc: 'Cada momento do seu dia se torna uma oportunidade de aprendizado natural — sem sobrecarregar sua agenda.',
  philosophyPillar1Tag: 'Zero Sobrecarga',
  philosophyPillar2Title: '5 Palavras Chave por Atividade',
  philosophyPillar2Desc: 'Foque apenas nas palavras e expressões essenciais para cada momento. Qualidade e contexto superam quantidade.',
  philosophyPillar2Tag: 'Aprendizado Focado',
  philosophyPillar3Title: 'Amigos Nativos & IA',
  philosophyPillar3Desc: 'Sessões individuais ao vivo no Google Meet combinadas com correções instantâneas de IA no seu diário.',
  philosophyPillar3Tag: 'Imersão Humana + IA',
  footerSlogan: 'Learn English by living your life!',
};

interface AdminLandingEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentContent: AdminLandingContent | null;
  onSaveContent?: (updated: AdminLandingContent) => void;
  onSave?: (updated: AdminLandingContent) => void;
  currentLanguage: Language;
}

export const AdminLandingEditorModal: React.FC<AdminLandingEditorModalProps> = ({
  isOpen,
  onClose,
  currentContent,
  onSaveContent,
  onSave,
  currentLanguage,
}) => {
  const [formData, setFormData] = useState<AdminLandingContent>(() => ({
    ...DEFAULT_ADMIN_LANDING_CONTENT,
    ...(currentContent || {}),
  }));
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'hero' | 'philosophy' | 'footer'>('hero');

  if (!isOpen) return null;

  const isEn = currentLanguage === 'en';

  const handleChange = (field: keyof AdminLandingContent, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (onSave) onSave(formData);
    else if (onSaveContent) onSaveContent(formData);

    try {
      await fetch('/api/landing-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
    } catch (err) {
      console.warn('Error saving landing content:', err);
    }

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1200);
  };

  const handleResetDefaults = () => {
    if (confirm(isEn ? 'Reset to default texts?' : 'Deseja restaurar os textos padrão?')) {
      const defaults: AdminLandingContent = {
        heroBadge: 'Uma Nova Filosofia de Inglês',
        heroHeadlineStart: 'Learn English by',
        heroHeadlineHighlight: 'Living your Life',
        heroQuote: '“Você não precisa estudar mais. Você pode viver em inglês.”',
        heroSubtext: 'Transforme sua rotina diária em prática real. Do café da manhã ao trabalho e descanso noturno. Sua vida. Seu inglês. Do seu jeito.',
        heroFindFriendBtn: 'Encontre Seu Amigo Nativo',
        heroStartLivingBtn: 'Comece a Viver em Inglês',
        philosophyBadge: 'A Ciência do Hábito',
        philosophyHeading1: 'Não mude sua rotina.',
        philosophyHeading2: 'Viva-a em Inglês.',
        philosophySubheading: 'Aprender inglês não precisa ser uma tarefa pesada de 2 horas em uma sala de aula após um longo dia de trabalho. Conectamos seu aprendizado com o que você já faz todos os dias.',
        philosophyPillar1Title: 'Prática Integrada à Sua Vida',
        philosophyPillar1Desc: 'Cada momento do seu dia se torna uma oportunidade de aprendizado natural — sem sobrecarregar sua agenda.',
        philosophyPillar1Tag: 'Zero Sobrecarga',
        philosophyPillar2Title: '5 Palavras Chave por Atividade',
        philosophyPillar2Desc: 'Foque apenas nas palavras e expressões essenciais para cada momento. Qualidade e contexto superam quantidade.',
        philosophyPillar2Tag: 'Aprendizado Focado',
        philosophyPillar3Title: 'Amigos Nativos & IA',
        philosophyPillar3Desc: 'Sessões individuais ao vivo no Google Meet combinadas com correções instantâneas de IA no seu diário.',
        philosophyPillar3Tag: 'Imersão Humana + IA',
        footerSlogan: 'Learn English by living your life!',
      };
      setFormData(defaults);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#000035]/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto" id="admin-landing-editor-modal">
      <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-[#607EC9]/40 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-6 bg-[#000035] text-white flex items-center justify-between border-b border-[#1C4C96] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#F4CA54] text-[#000035] flex items-center justify-center font-black shadow-xs">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-white">
                  {isEn ? 'Landing Page Live Content Editor' : 'Editor de Textos da Página Inicial'}
                </h2>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-[#1C4C96] text-[#9AB4FF] uppercase">
                  ADMIN ONLY
                </span>
              </div>
              <p className="text-xs text-[#9AB4FF]">
                {isEn
                  ? 'Changes are saved immediately and visible to all visitors.'
                  : 'Edite todos os campos da página inicial. Apenas visível para você.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 p-3 bg-slate-100 border-b border-slate-200 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('hero')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeTab === 'hero' ? 'bg-[#000035] text-white shadow-xs' : 'bg-white text-slate-600 hover:bg-slate-200'
            }`}
          >
            {isEn ? '1. Hero & Header' : '1. Cabeçalho & Hero'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('philosophy')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeTab === 'philosophy' ? 'bg-[#000035] text-white shadow-xs' : 'bg-white text-slate-600 hover:bg-slate-200'
            }`}
          >
            {isEn ? '2. Philosophy Pillars' : '2. Pilares da Filosofia'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('footer')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              activeTab === 'footer' ? 'bg-[#000035] text-white shadow-xs' : 'bg-white text-slate-600 hover:bg-slate-200'
            }`}
          >
            {isEn ? '3. Footer & Slogan' : '3. Rodapé & Slogan'}
          </button>

          <button
            type="button"
            onClick={handleResetDefaults}
            className="ml-auto px-3 py-1.5 text-xs text-slate-500 hover:text-red-600 transition flex items-center gap-1 cursor-pointer"
            title="Reset to defaults"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isEn ? 'Reset' : 'Restaurar Padrão'}</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
          {savedSuccess && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-2xl text-xs font-bold text-emerald-800 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{isEn ? 'Landing page updated successfully!' : 'Página inicial atualizada com sucesso!'}</span>
            </div>
          )}

          {activeTab === 'hero' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isEn ? 'Hero Badge Label' : 'Badge Superior do Hero'}
                </label>
                <input
                  type="text"
                  value={formData.heroBadge}
                  onChange={(e) => handleChange('heroBadge', e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isEn ? 'Headline Start (e.g. Learn English by)' : 'Início do Título Principal'}
                  </label>
                  <input
                    type="text"
                    value={formData.heroHeadlineStart}
                    onChange={(e) => handleChange('heroHeadlineStart', e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isEn ? 'Headline Highlight (e.g. Living your Life)' : 'Destaque Dourado do Título'}
                  </label>
                  <input
                    type="text"
                    value={formData.heroHeadlineHighlight}
                    onChange={(e) => handleChange('heroHeadlineHighlight', e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isEn ? 'Quote in Hero' : 'Frase de Destaque / Citação'}
                </label>
                <input
                  type="text"
                  value={formData.heroQuote}
                  onChange={(e) => handleChange('heroQuote', e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isEn ? 'Hero Subtitle Description' : 'Texto Descritivo do Hero'}
                </label>
                <textarea
                  rows={3}
                  value={formData.heroSubtext}
                  onChange={(e) => handleChange('heroSubtext', e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isEn ? 'Primary Button Text' : 'Texto do Botão Principal (Buscar Amigo)'}
                  </label>
                  <input
                    type="text"
                    value={formData.heroFindFriendBtn}
                    onChange={(e) => handleChange('heroFindFriendBtn', e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs text-[#000035]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isEn ? 'Secondary Button Text' : 'Texto do Botão Secundário (Começar a Viver)'}
                  </label>
                  <input
                    type="text"
                    value={formData.heroStartLivingBtn}
                    onChange={(e) => handleChange('heroStartLivingBtn', e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs text-[#000035]"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'philosophy' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isEn ? 'Philosophy Title Line 1' : 'Título da Filosofia (Linha 1)'}
                  </label>
                  <input
                    type="text"
                    value={formData.philosophyHeading1}
                    onChange={(e) => handleChange('philosophyHeading1', e.target.value)}
                    className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs text-[#000035]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isEn ? 'Philosophy Title Line 2' : 'Título da Filosofia (Linha 2)'}
                  </label>
                  <input
                    type="text"
                    value={formData.philosophyHeading2}
                    onChange={(e) => handleChange('philosophyHeading2', e.target.value)}
                    className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs text-[#000035]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isEn ? 'Philosophy Subheading' : 'Subtítulo Explicativo da Filosofia'}
                </label>
                <textarea
                  rows={2}
                  value={formData.philosophySubheading}
                  onChange={(e) => handleChange('philosophySubheading', e.target.value)}
                  className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs text-[#000035]"
                />
              </div>

              {/* Pillar 1 */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <span className="text-xs font-bold text-[#1C4C96]">Pilar 1</span>
                <input
                  type="text"
                  value={formData.philosophyPillar1Title}
                  onChange={(e) => handleChange('philosophyPillar1Title', e.target.value)}
                  placeholder="Título do Pilar 1"
                  className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-[#000035]"
                />
                <textarea
                  rows={2}
                  value={formData.philosophyPillar1Desc}
                  onChange={(e) => handleChange('philosophyPillar1Desc', e.target.value)}
                  placeholder="Descrição do Pilar 1"
                  className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-700"
                />
              </div>

              {/* Pillar 2 */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <span className="text-xs font-bold text-[#1C4C96]">Pilar 2</span>
                <input
                  type="text"
                  value={formData.philosophyPillar2Title}
                  onChange={(e) => handleChange('philosophyPillar2Title', e.target.value)}
                  placeholder="Título do Pilar 2"
                  className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-[#000035]"
                />
                <textarea
                  rows={2}
                  value={formData.philosophyPillar2Desc}
                  onChange={(e) => handleChange('philosophyPillar2Desc', e.target.value)}
                  placeholder="Descrição do Pilar 2"
                  className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-700"
                />
              </div>

              {/* Pillar 3 */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <span className="text-xs font-bold text-[#1C4C96]">Pilar 3</span>
                <input
                  type="text"
                  value={formData.philosophyPillar3Title}
                  onChange={(e) => handleChange('philosophyPillar3Title', e.target.value)}
                  placeholder="Título do Pilar 3"
                  className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-[#000035]"
                />
                <textarea
                  rows={2}
                  value={formData.philosophyPillar3Desc}
                  onChange={(e) => handleChange('philosophyPillar3Desc', e.target.value)}
                  placeholder="Descrição do Pilar 3"
                  className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-700"
                />
              </div>
            </div>
          )}

          {activeTab === 'footer' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isEn ? 'Footer Slogan' : 'Slogan do Rodapé (idêntico ao cabeçalho)'}
                </label>
                <input
                  type="text"
                  value={formData.footerSlogan}
                  onChange={(e) => handleChange('footerSlogan', e.target.value)}
                  placeholder="Learn English by living your life!"
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035] font-bold"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  {isEn
                    ? 'Matches header tagline cleanly without extra sentences.'
                    : 'Mantém o slogan limpo e sem repetições adicionais.'}
                </p>
              </div>
            </div>
          )}

          {/* Action Save Bar */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-900 transition"
            >
              {isEn ? 'Cancel' : 'Cancelar'}
            </button>

            <button
              type="submit"
              className="px-6 py-2.5 bg-[#000035] hover:bg-[#1C4C96] text-white rounded-xl text-xs font-black transition cursor-pointer shadow-md flex items-center gap-2"
            >
              <Save className="w-4 h-4 text-[#F4CA54]" />
              <span>{isEn ? 'Save All Changes' : 'Salvar Alterações'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
