import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  MessageSquare,
  Send,
  X,
  CheckCheck,
  Clock,
  Sparkles,
  User,
  Mail,
  ChevronDown,
} from 'lucide-react';
import {
  GoogleAccount,
  UserProfile,
  Language,
  NativeFriendTutor,
  LiveLesson,
  DirectMessage,
} from '../types';
import {
  subscribeDirectMessages,
  sendDirectMessage,
  markDirectMessagesAsRead,
  normalizeUid,
} from '../utils/directMessages';

interface HeaderMessagesPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccount: GoogleAccount | null;
  userProfile: UserProfile;
  tutors?: NativeFriendTutor[];
  lessons?: LiveLesson[];
  students?: GoogleAccount[];
  currentLanguage: Language;
  onUnreadChange?: (count: number) => void;
}

export const HeaderMessagesPopover: React.FC<HeaderMessagesPopoverProps> = ({
  isOpen,
  onClose,
  currentAccount,
  userProfile,
  tutors = [],
  lessons = [],
  students = [],
  currentLanguage,
  onUnreadChange,
}) => {
  const isEn = currentLanguage === 'en';
  const isTeacher = currentAccount?.role === 'teacher';
  const isAdmin = currentAccount?.role === 'admin';

  // 1. Identify Student UID & Email
  const studentEmail = useMemo(() => {
    if (isTeacher) return '';
    return (currentAccount?.email || userProfile?.email || '').toLowerCase().trim();
  }, [isTeacher, currentAccount?.email, userProfile?.email]);

  const studentUid = useMemo(() => {
    if (isTeacher) return '';
    return normalizeUid(
      (currentAccount as any)?.uid ||
        currentAccount?.id ||
        (userProfile as any)?.uid ||
        userProfile?.id ||
        (studentEmail ? `usr-${studentEmail.replace(/[^a-zA-Z0-9]/g, '-')}` : 'student-default')
    );
  }, [isTeacher, currentAccount, userProfile, studentEmail]);

  // 2. Identify Active Native Friend (Tutor)
  const fallbackLessonTeacher = useMemo(() => {
    return (lessons || []).find((l) => l.teacherEmail && (l.status === 'scheduled' || l.status === 'completed'));
  }, [lessons]);

  const activeNativeFriend = useMemo<NativeFriendTutor | null>(() => {
    if (isTeacher) return null;
    const targetEmail = (userProfile?.teacherEmail || fallbackLessonTeacher?.teacherEmail || '').toLowerCase().trim();

    if (targetEmail && tutors && tutors.length > 0) {
      const found = tutors.find((t) => (t.email || '').toLowerCase().trim() === targetEmail);
      if (found) return found;
    }

    if (tutors && tutors.length > 0) {
      return tutors[0];
    }

    if (targetEmail) {
      return {
        id: `tutor-${targetEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
        uid: `tutor-${targetEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
        name: userProfile?.teacherName || fallbackLessonTeacher?.teacherName || targetEmail.split('@')[0],
        email: targetEmail,
        avatar: '',
        role: 'teacher',
        approvalStatus: 'approved',
      } as any;
    }

    return null;
  }, [isTeacher, userProfile?.teacherEmail, userProfile?.teacherName, fallbackLessonTeacher, tutors]);

  const activeNativeFriendUid = useMemo(() => {
    if (isTeacher) {
      return normalizeUid(
        (currentAccount as any)?.uid ||
          currentAccount?.id ||
          (currentAccount?.email ? `tutor-${currentAccount.email.replace(/[^a-zA-Z0-9]/g, '-')}` : 'tutor-default')
      );
    }
    return normalizeUid(
      activeNativeFriend?.uid ||
        activeNativeFriend?.id ||
        (activeNativeFriend?.email
          ? `tutor-${activeNativeFriend.email.replace(/[^a-zA-Z0-9]/g, '-')}`
          : 'tutor-charles-001')
    );
  }, [isTeacher, currentAccount, activeNativeFriend]);

  // Teacher perspective: Pick which student to message
  const [selectedTeacherStudentEmail, setSelectedTeacherStudentEmail] = useState<string>('');
  useEffect(() => {
    if (isTeacher && students && students.length > 0 && !selectedTeacherStudentEmail) {
      setSelectedTeacherStudentEmail(students[0].email || '');
    }
  }, [isTeacher, students, selectedTeacherStudentEmail]);

  const activeStudentForTeacher = useMemo(() => {
    if (!isTeacher) return null;
    return students.find((s) => s.email?.toLowerCase().trim() === selectedTeacherStudentEmail.toLowerCase().trim()) || students[0] || null;
  }, [isTeacher, students, selectedTeacherStudentEmail]);

  // Effective Pair for Exclusive Direct Messages
  const effectiveStudentUid = useMemo(() => {
    if (isTeacher) {
      return normalizeUid(
        (activeStudentForTeacher as any)?.uid ||
          activeStudentForTeacher?.id ||
          (activeStudentForTeacher?.email ? `usr-${activeStudentForTeacher.email.replace(/[^a-zA-Z0-9]/g, '-')}` : '')
      );
    }
    return studentUid;
  }, [isTeacher, activeStudentForTeacher, studentUid]);

  const effectiveNativeFriendUid = activeNativeFriendUid;

  // Messages State
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Subscribe to Direct Messages between this exclusive pair
  useEffect(() => {
    if (!effectiveStudentUid || !effectiveNativeFriendUid) {
      setMessages([]);
      return;
    }

    const unsubscribe = subscribeDirectMessages(
      effectiveStudentUid,
      effectiveNativeFriendUid,
      (updatedList) => {
        setMessages(updatedList);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [effectiveStudentUid, effectiveNativeFriendUid]);

  // Calculate unread messages
  const unreadCount = useMemo(() => {
    if (!messages || messages.length === 0) return 0;
    if (isTeacher) {
      // Unread messages sent by student to this teacher
      return messages.filter((m) => m.senderRole === 'student' && !m.read).length;
    }
    // Unread messages sent by Native Friend to this student
    return messages.filter((m) => (m.senderRole === 'teacher' || m.senderRole === 'admin') && !m.read).length;
  }, [messages, isTeacher]);

  // Notify parent of unread count change
  useEffect(() => {
    if (onUnreadChange) {
      onUnreadChange(unreadCount);
    }
  }, [unreadCount, onUnreadChange]);

  // When popover is opened, mark unread messages as read
  useEffect(() => {
    if (isOpen && messages.length > 0) {
      const unreadIds = messages
        .filter((m) => {
          if (isTeacher) return m.senderRole === 'student' && !m.read;
          return (m.senderRole === 'teacher' || m.senderRole === 'admin') && !m.read;
        })
        .map((m) => m.id);

      if (unreadIds.length > 0) {
        markDirectMessagesAsRead(unreadIds);
      }
    }
  }, [isOpen, messages, isTeacher]);

  // Scroll to bottom when messages update or popover opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [isOpen, messages.length]);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Send Message Handler
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || isSending) return;

    if (!effectiveStudentUid || !effectiveNativeFriendUid) return;

    setIsSending(true);
    setInputText('');

    const senderRole = isTeacher ? 'teacher' : 'student';
    const senderUid = isTeacher ? effectiveNativeFriendUid : effectiveStudentUid;
    const recipientUid = isTeacher ? effectiveStudentUid : effectiveNativeFriendUid;

    const studentName = isTeacher
      ? activeStudentForTeacher?.name || 'Student'
      : currentAccount?.name || userProfile?.name || 'Student';
    const studentMail = isTeacher
      ? activeStudentForTeacher?.email || ''
      : currentAccount?.email || userProfile?.email || '';

    const tutorName = isTeacher
      ? currentAccount?.name || 'Native Friend'
      : activeNativeFriend?.name || userProfile?.teacherName || 'Native Friend';
    const tutorMail = isTeacher
      ? currentAccount?.email || ''
      : activeNativeFriend?.email || userProfile?.teacherEmail || '';
    const tutorAvatar = isTeacher
      ? currentAccount?.picture || ''
      : activeNativeFriend?.avatar || '';

    try {
      await sendDirectMessage({
        studentUid: effectiveStudentUid,
        studentEmail: studentMail,
        studentName,
        nativeFriendUid: effectiveNativeFriendUid,
        nativeFriendEmail: tutorMail,
        nativeFriendName: tutorName,
        nativeFriendAvatar: tutorAvatar,
        senderUid,
        senderEmail: isTeacher ? tutorMail : studentMail,
        senderName: isTeacher ? tutorName : studentName,
        senderRole,
        recipientUid,
        text,
      });
    } catch (err) {
      console.warn('Failed to send direct message:', err);
    } finally {
      setIsSending(false);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatMessageTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString(isEn ? 'en-US' : 'pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: isEn,
      });
    } catch {
      return '';
    }
  };

  const formatMessageDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const today = new Date();
      if (date.toDateString() === today.toDateString()) {
        return isEn ? 'Today' : 'Hoje';
      }
      return date.toLocaleDateString(isEn ? 'en-US' : 'pt-BR', {
        day: 'numeric',
        month: 'short',
      });
    } catch {
      return '';
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      id="header-direct-messages-popover"
      className="absolute right-0 top-full mt-2 w-[340px] sm:w-[410px] max-w-[calc(100vw-1.5rem)] bg-white rounded-3xl shadow-2xl border border-[#607EC9]/30 z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
      style={{ maxHeight: 'calc(100vh - 5.5rem)' }}
    >
      {/* 1. Header of Popover */}
      <div className="px-4 py-3.5 bg-gradient-to-r from-[#062863] via-[#000035] to-[#1C4C96] text-white flex items-center justify-between gap-2 shrink-0 border-b border-[#607EC9]/20">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Avatar */}
          <div className="relative shrink-0">
            <div className="w-9 h-9 rounded-2xl overflow-hidden bg-white/10 border border-white/20 flex items-center justify-center">
              {isTeacher ? (
                activeStudentForTeacher?.picture ? (
                  <img
                    src={activeStudentForTeacher.picture}
                    alt={activeStudentForTeacher.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <User className="w-4 h-4 text-[#9AB4FF]" />
                )
              ) : activeNativeFriend?.avatar ? (
                <img
                  src={activeNativeFriend.avatar}
                  alt={activeNativeFriend.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <MessageSquare className="w-4 h-4 text-[#9AB4FF]" />
              )}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 border-2 border-[#000035] rounded-full" />
          </div>

          {/* Title & Subtitle */}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-black truncate max-w-[150px] sm:max-w-[200px]">
                {isTeacher
                  ? activeStudentForTeacher?.name || (isEn ? 'Student' : 'Aluno')
                  : activeNativeFriend?.name || (isEn ? 'Native Friend' : 'Amigo Nativo')}
              </span>
              <span className="text-[9px] font-bold px-1.5 py-0.2 bg-white/15 text-[#9AB4FF] rounded-full uppercase tracking-wider">
                {isTeacher
                  ? (isEn ? 'Student' : 'Aluno')
                  : (isEn ? 'Native Friend' : 'Amigo Nativo')}
              </span>
            </div>
            <span className="text-[10px] text-white/75 block truncate">
              {isEn ? 'Direct Messages & Notices' : 'Recados e Orientações'}
            </span>
          </div>
        </div>

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-xl hover:bg-white/15 text-white/80 hover:text-white transition cursor-pointer"
          title={isEn ? 'Close' : 'Fechar'}
          id="close-messages-popover-btn"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Teacher Student Switcher (If Teacher has multiple students) */}
      {isTeacher && students && students.length > 1 && (
        <div className="px-3 py-1.5 bg-[#9AB4FF]/10 border-b border-[#607EC9]/20 flex items-center justify-between gap-2 text-xs">
          <span className="text-[11px] font-bold text-[#062863]">
            {isEn ? 'Student:' : 'Aluno:'}
          </span>
          <select
            value={selectedTeacherStudentEmail}
            onChange={(e) => setSelectedTeacherStudentEmail(e.target.value)}
            className="text-xs font-semibold bg-white border border-[#607EC9]/30 rounded-lg px-2 py-1 text-[#000035] focus:outline-none focus:ring-1 focus:ring-[#1C4C96] cursor-pointer max-w-[220px] truncate"
          >
            {students.map((s) => (
              <option key={s.email} value={s.email}>
                {s.name} ({s.email})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 2. Message History Body */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-3 min-h-[240px] max-h-[340px] bg-slate-50/50">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 my-6 text-slate-500">
            <div className="w-11 h-11 rounded-2xl bg-[#9AB4FF]/20 text-[#1C4C96] flex items-center justify-center mb-2.5 shadow-2xs">
              <Mail className="w-5 h-5" />
            </div>
            <p className="text-xs font-bold text-[#000035] mb-1">
              {isEn ? 'No messages yet' : 'Nenhum recado ainda'}
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-[260px]">
              {isTeacher
                ? (isEn
                    ? 'Send a friendly check-in, study notice, or pronunciation feedback to your student.'
                    : 'Envie um aviso, dica de pronúncia ou recado assíncrono para seu aluno.')
                : (isEn
                    ? 'Leave a note or question for your Native Friend about your routines, vocabulary, or upcoming lesson.'
                    : 'Deixe uma dúvida rápida sobre vocabulário, rotina ou um recado antes da sua aula com seu Amigo Nativo.')}
            </p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMe = isTeacher ? msg.senderRole === 'teacher' : msg.senderRole === 'student';
            const showDateHeader =
              index === 0 ||
              formatMessageDate(msg.createdAt) !== formatMessageDate(messages[index - 1].createdAt);

            return (
              <React.Fragment key={msg.id || index}>
                {showDateHeader && (
                  <div className="flex items-center justify-center my-1.5">
                    <span className="text-[10px] font-bold text-slate-400 bg-white/90 px-2.5 py-0.5 rounded-full border border-slate-200/60 shadow-2xs">
                      {formatMessageDate(msg.createdAt)}
                    </span>
                  </div>
                )}

                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-2xs transition-all ${
                      isMe
                        ? 'bg-[#062863] text-white rounded-tr-xs'
                        : 'bg-white text-[#000035] rounded-tl-xs border border-[#607EC9]/20'
                    }`}
                  >
                    {!isMe && (
                      <span className="block text-[10px] font-extrabold text-[#1C4C96] mb-0.5">
                        {msg.senderName}
                      </span>
                    )}

                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>

                    <div
                      className={`flex items-center justify-end gap-1 mt-1 text-[9px] ${
                        isMe ? 'text-white/70' : 'text-slate-400'
                      }`}
                    >
                      <span>{formatMessageTime(msg.createdAt)}</span>
                      {isMe && (
                        <CheckCheck
                          className={`w-3 h-3 ${msg.read ? 'text-[#9AB4FF]' : 'text-white/60'}`}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick suggestions pills for students */}
      {!isTeacher && messages.length <= 2 && (
        <div className="px-3 pt-1 pb-1.5 bg-white border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto text-[10px]">
          <button
            type="button"
            onClick={() => setInputText(isEn ? 'Hi! I have a question about today\'s routine vocabulary.' : 'Oi! Tenho uma dúvida sobre o vocabulário da rotina de hoje.')}
            className="px-2 py-0.5 bg-[#9AB4FF]/15 hover:bg-[#9AB4FF]/30 text-[#062863] rounded-full font-medium transition shrink-0 cursor-pointer"
          >
            {isEn ? 'Vocabulary doubt' : 'Dúvida da rotina'}
          </button>
          <button
            type="button"
            onClick={() => setInputText(isEn ? 'See you in our next Meet lesson!' : 'Nos vemos na próxima aula no Meet!')}
            className="px-2 py-0.5 bg-[#9AB4FF]/15 hover:bg-[#9AB4FF]/30 text-[#062863] rounded-full font-medium transition shrink-0 cursor-pointer"
          >
            {isEn ? 'Lesson check-in' : 'Aviso para a aula'}
          </button>
        </div>
      )}

      {/* 3. Message Input Footer */}
      <form
        onSubmit={handleSendMessage}
        className="p-2.5 bg-white border-t border-[#607EC9]/20 flex items-center gap-2 shrink-0"
      >
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={
            isTeacher
              ? (isEn ? 'Send a notice or note to student...' : 'Escreva um recado para o aluno...')
              : (isEn ? 'Send a notice to your Native Friend...' : 'Escreva um recado para seu Amigo Nativo...')
          }
          className="flex-1 resize-none py-2 px-3 text-xs bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-[#607EC9]/30 rounded-xl focus:outline-none focus:ring-1 focus:ring-[#1C4C96] text-[#000035] placeholder:text-slate-400 transition"
          maxLength={2000}
        />

        <button
          type="submit"
          disabled={!inputText.trim() || isSending}
          className="p-2.5 rounded-xl bg-[#062863] hover:bg-[#000035] disabled:opacity-40 text-white transition cursor-pointer shrink-0 shadow-xs flex items-center justify-center"
          title={isEn ? 'Send message' : 'Enviar recado'}
          id="send-direct-message-btn"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
