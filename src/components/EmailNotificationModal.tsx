import React, { useState, useEffect } from 'react';
import {
  X,
  Mail,
  Send,
  Check,
  UserCheck,
  AlertCircle,
} from 'lucide-react';
import { GoogleAccount, Language, UserProfile } from '../types';
import { sendEmailNotificationApi } from '../utils/gmail';

export interface RoutineActivitySummary {
  name?: string;
  nameEn?: string;
  time?: string;
  words?: string[];
  notes?: string;
}

interface EmailNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccount: GoogleAccount | null;
  userProfile?: UserProfile | null;
  teachers: GoogleAccount[];
  activityName?: string;
  activities?: RoutineActivitySummary[];
  dailyPhrase?: string;
  selectedDayName?: string;
  currentLanguage: Language;
}

export const EmailNotificationModal: React.FC<EmailNotificationModalProps> = ({
  isOpen,
  onClose,
  currentAccount,
  userProfile,
  teachers,
  activityName = 'Daily English Practice',
  activities = [],
  dailyPhrase = '',
  selectedDayName = 'Hoje',
  currentLanguage,
}) => {
  const isEn = currentLanguage === 'en';

  // Target native friend priority: 1. Student's assigned native friend in userProfile, 2. Teachers list
  const preferredTeacherEmail =
    userProfile?.teacherEmail ||
    teachers[0]?.email ||
    'itissimple.school@gmail.com';
  const preferredTeacherName =
    userProfile?.teacherName ||
    teachers.find((t) => t.email.toLowerCase() === preferredTeacherEmail.toLowerCase())?.name ||
    'Amigo Nativo';

  const [recipient, setRecipient] = useState<string>(preferredTeacherEmail);

  // Compose clean routine summary
  const activitiesSummary = activities.length > 0
    ? activities
        .map((act, idx) => {
          const wordsStr = (act.words && act.words.length > 0)
            ? `\n   • Palavras-chave: ${act.words.join(', ')}`
            : '';
          const notesStr = act.notes ? `\n   • Anotações: ${act.notes}` : '';
          return `${idx + 1}. [${act.time || '--:--'}] ${act.nameEn || act.name || 'Atividade'}${wordsStr}${notesStr}`;
        })
        .join('\n\n')
    : `• ${activityName}`;

  const phraseSection = dailyPhrase
    ? `\n\n📌 Frase do Dia (Daily Phrase):\n"${dailyPhrase}"`
    : '';

  const studentName = userProfile?.name || currentAccount?.name || 'Aluno It\'s Simple';

  const defaultSubject = isEn
    ? `[It's Simple] Daily Routine from ${studentName} - ${selectedDayName}`
    : `[It's Simple] Rotina Diária de ${studentName} - ${selectedDayName}`;

  const defaultBody = isEn
    ? `Hi ${preferredTeacherName},\n\nI have just registered my daily routine for ${selectedDayName} on the It's Simple platform. Here is what I am living in English today:\n\n${activitiesSummary}${phraseSection}\n\nLooking forward to our conversation practice!\n\nBest regards,\n${studentName} (${currentAccount?.email || userProfile?.email || ''})`
    : `Olá ${preferredTeacherName},\n\nAcabei de cadastrar minha rotina diária de ${selectedDayName} na plataforma It's Simple. Aqui está o que estou vivendo em inglês hoje:\n\n${activitiesSummary}${phraseSection}\n\nAguardo seu feedback e nossa próxima sessão de conversação no Google Meet!\n\nUm abraço,\n${studentName} (${currentAccount?.email || userProfile?.email || ''})`;

  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [sentSuccess, setSentSuccess] = useState<boolean>(false);

  useEffect(() => {
    setRecipient(preferredTeacherEmail);
    setSubject('');
    setBody('');
  }, [preferredTeacherEmail, isOpen]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);

    try {
      await sendEmailNotificationApi({
        to: recipient,
        subject: subject.trim() || defaultSubject,
        body: body.trim() || defaultBody,
        fromEmail: currentAccount?.email || userProfile?.email || 'student@itissimple.com',
        fromName: studentName,
      });

      setSentSuccess(true);
      setTimeout(() => {
        setSentSuccess(false);
        onClose();
      }, 1500);
    } catch (err) {
      console.warn('Error sending email:', err);
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#000035]/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-[#607EC9]/30 overflow-hidden my-auto">
        {/* Header */}
        <div className="px-6 py-4 bg-[#000035] text-white flex items-center justify-between border-b border-[#1C4C96]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1C4C96] flex items-center justify-center text-white shadow-xs border border-[#9AB4FF]/40">
              <Mail className="w-5 h-5 text-[#9AB4FF]" />
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-white">
                {isEn ? 'Send Routine to Native Friend' : 'Enviar Rotina ao Amigo Nativo'}
              </h3>
              <p className="text-xs text-[#9AB4FF]">
                {isEn ? 'Instant email notification via Gmail' : 'Notificação instantânea de rotina via Gmail'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-[#1C4C96] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSend} className="p-6 space-y-4">
          {sentSuccess && (
            <div className="p-3 bg-[#9AB4FF]/20 border border-[#607EC9] rounded-2xl text-xs font-bold text-[#062863] flex items-center gap-2">
              <Check className="w-4 h-4 text-[#1C4C96]" />
              <span>{isEn ? 'Routine email sent successfully!' : 'E-mail com sua rotina enviado com sucesso ao seu Amigo Nativo!'}</span>
            </div>
          )}

          {userProfile?.teacherEmail ? (
            <div className="p-3 bg-[#9AB4FF]/15 border border-[#607EC9]/30 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#062863] text-white flex items-center justify-center text-xs font-black">
                  <UserCheck className="w-4 h-4 text-[#9AB4FF]" />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-[#062863] uppercase tracking-wide">
                    {isEn ? 'Selected Native Friend' : 'Seu Amigo Nativo Selecionado'}
                  </div>
                  <div className="text-xs font-bold text-[#000035]">
                    {userProfile.teacherName || userProfile.teacherEmail} ({userProfile.teacherEmail})
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-2 text-xs text-amber-900">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                {isEn
                  ? 'You can select a Native Friend below or manage your subscription in your profile.'
                  : 'Selecione abaixo o Amigo Nativo para receber sua rotina diária.'}
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#000035] mb-1">
              {isEn ? 'Recipient (Native Friend)' : 'Destinatário (Amigo Nativo)'}
            </label>
            <select
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035] font-medium"
            >
              {userProfile?.teacherEmail && (
                <option value={userProfile.teacherEmail}>
                  ⭐ {userProfile.teacherName || userProfile.teacherEmail} ({userProfile.teacherEmail})
                </option>
              )}
              {teachers
                .filter((tc) => tc.email.toLowerCase() !== userProfile?.teacherEmail?.toLowerCase())
                .map((tc) => (
                  <option key={tc.email} value={tc.email}>
                    {tc.name} ({tc.email})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#000035] mb-1">
              {isEn ? 'Subject' : 'Assunto'}
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={defaultSubject}
              className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035] font-medium placeholder:text-slate-400"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#000035] mb-1">
              {isEn ? 'Routine Details & Message' : 'Conteúdo da Rotina & Mensagem'}
            </label>
            <textarea
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={defaultBody}
              className="w-full p-2.5 bg-white border border-[#607EC9]/40 rounded-xl text-xs text-[#000035] font-mono leading-relaxed placeholder:text-slate-400"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition"
            >
              {isEn ? 'Cancel' : 'Cancelar'}
            </button>
            <button
              type="submit"
              disabled={isSending}
              className="px-5 py-2 bg-[#1C4C96] hover:bg-[#062863] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSending ? (isEn ? 'Sending...' : 'Enviando...') : isEn ? 'Send Routine Now' : 'Enviar Rotina Agora'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
