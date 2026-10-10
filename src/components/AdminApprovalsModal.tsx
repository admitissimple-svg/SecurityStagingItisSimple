import React, { useState, useEffect } from 'react';
import {
  X,
  UserCheck,
  CheckCircle,
  XCircle,
  Clock,
  Mail,
  MapPin,
  DollarSign,
  ShieldCheck,
  Video,
  ExternalLink,
  Trash2,
  RefreshCw,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { NativeFriendTutor, Language } from '../types';

interface AdminApprovalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tutors: NativeFriendTutor[];
  onApproveTutor: (tutorId: string, tutor?: NativeFriendTutor) => void;
  onRejectTutor: (tutorId: string, tutor?: NativeFriendTutor) => void;
  onDeleteTutor?: (tutorId: string, tutorEmail?: string) => Promise<void> | void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  currentLanguage: Language;
}

export const AdminApprovalsModal: React.FC<AdminApprovalsModalProps> = ({
  isOpen,
  onClose,
  tutors,
  onApproveTutor,
  onRejectTutor,
  onDeleteTutor,
  onRefresh,
  isRefreshing = false,
  currentLanguage,
}) => {
  const isTutorApproved = (t: NativeFriendTutor) =>
    t.approvalStatus === 'approved' ||
    t.isApproved === true ||
    (t as any).status === 'approved' ||
    (t as any).approved === true;

  const isTutorRejected = (t: NativeFriendTutor) =>
    !isTutorApproved(t) &&
    (t.approvalStatus === 'rejected' || (t as any).status === 'rejected');

  const pendingCount = tutors.filter((t) => !isTutorApproved(t) && !isTutorRejected(t)).length;
  const approvedCount = tutors.filter((t) => isTutorApproved(t)).length;
  const rejectedCount = tutors.filter((t) => isTutorRejected(t)).length;

  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionNotification, setActionNotification] = useState<string | null>(null);

  // When modal opens, default to pending if any are waiting for review, otherwise show all
  useEffect(() => {
    if (isOpen) {
      setFilter(pendingCount > 0 ? 'pending' : 'all');
    }
  }, [isOpen]);

  // Support ESC key to easily dismiss modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isEn = currentLanguage === 'en';

  const filteredTutors = tutors.filter((t) => {
    const status = isTutorApproved(t)
      ? 'approved'
      : isTutorRejected(t)
      ? 'rejected'
      : 'pending';
    if (filter === 'all') return true;
    return status === filter;
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-[#000035]/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      id="admin-approvals-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-[#607EC9]/40 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-[#000035] via-[#062863] to-[#1C4C96] text-white flex items-center justify-between border-b border-[#607EC9]/40 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#1C4C96] text-[#F4CA54] flex items-center justify-center font-black shadow-md border border-[#9AB4FF]/50">
              <UserCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg sm:text-xl font-black text-white">
                  {isEn ? 'Native Friend Approval Center' : 'Aprovação de Amigos Nativos'}
                </h2>
                {pendingCount > 0 && (
                  <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-[#F4CA54] text-[#000035]">
                    {pendingCount} {isEn ? 'Pending' : 'Pendentes'}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#9AB4FF]">
                {isEn
                  ? 'Review and authorize native friends before they appear on the public directory.'
                  : 'Revise e aprove cadastros antes de serem listados publicamente na plataforma.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-[#9AB4FF] hover:text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                title={isEn ? 'Refresh list' : 'Atualizar lista'}
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#F4CA54]' : ''}`} />
                <span className="hidden sm:inline">{isEn ? 'Refresh' : 'Atualizar'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-white/10 transition cursor-pointer"
              aria-label="Close"
              title="Fechar (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 p-4 bg-slate-50 border-b border-slate-200 shrink-0 overflow-x-auto">
          {[
            { id: 'all', label: isEn ? 'All Applications' : 'Todos', badge: tutors.length },
            { id: 'approved', label: isEn ? 'Approved Friends' : 'Aprovados', badge: approvedCount },
            { id: 'pending', label: isEn ? 'Pending Review' : 'Pendentes de Análise', badge: pendingCount },
            { id: 'rejected', label: isEn ? 'Rejected' : 'Recusados', badge: rejectedCount },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as any)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shrink-0 ${
                filter === tab.id
                  ? 'bg-[#000035] text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span className={`w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center ${
                  filter === tab.id ? 'bg-[#F4CA54] text-[#000035]' : 'bg-slate-200 text-slate-700'
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Action feedback toast */}
        {actionNotification && (
          <div className="mx-6 mt-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center justify-between animate-fadeIn">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{actionNotification}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionNotification(null)}
              className="text-emerald-700 hover:text-emerald-900 font-black cursor-pointer px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tutors list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {filteredTutors.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <ShieldCheck className="w-12 h-12 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-600">
                {isEn ? 'No applications in this status.' : 'Nenhum cadastro com este status.'}
              </p>
            </div>
          ) : (
            filteredTutors.map((tutor) => {
              const status = isTutorApproved(tutor)
                ? 'approved'
                : isTutorRejected(tutor)
                ? 'rejected'
                : 'pending';
              const avatarSrc =
                tutor.avatar ||
                tutor.photoUrl ||
                (tutor as any).picture ||
                '';

              return (
                <div
                  key={tutor.id}
                  className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm hover:border-[#607EC9]/70 transition flex flex-col md:flex-row items-start justify-between gap-5"
                >
                  {/* Tutor Info */}
                  <div className="flex items-start gap-4 flex-1">
                    {/* Tutor Avatar with Flag Badge */}
                    <div className="relative shrink-0">
                      {avatarSrc && avatarSrc.trim() !== '' ? (
                        <img
                          src={avatarSrc}
                          alt={tutor.name}
                          referrerPolicy="no-referrer"
                          className="w-20 h-20 rounded-2xl object-cover border-2 border-[#1C4C96]/30 shrink-0 shadow-sm bg-slate-100"
                        />
                      ) : (
                        <div className="w-20 h-20 rounded-2xl border-2 border-[#1C4C96]/30 shrink-0 shadow-sm bg-[#062863]/10 flex items-center justify-center text-[#1C4C96] font-bold text-2xl">
                          {tutor.name?.charAt(0) || 'T'}
                        </div>
                      )}
                      <div className="absolute -bottom-1 -right-1 bg-[#000035] text-white text-[10px] font-black px-1.5 py-0.5 rounded-md border border-white shadow-xs">
                        {tutor.flag || '🇺🇸'}
                      </div>
                    </div>

                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="text-base font-black text-[#000035]">{tutor.name}</h3>
                        {tutor.headline && (
                          <span className="text-xs text-slate-500 font-medium">({tutor.headline})</span>
                        )}

                        {status === 'pending' && (
                          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {isEn ? 'Pending Review' : 'Aguardando Aprovação'}
                          </span>
                        )}
                        {status === 'approved' && (
                          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-emerald-600" />
                            {isEn ? 'Approved & Public' : 'Aprovado e Público'}
                          </span>
                        )}
                        {status === 'rejected' && (
                          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-900 border border-rose-300 flex items-center gap-1">
                            <XCircle className="w-3 h-3 text-rose-600" />
                            {isEn ? 'Rejected' : 'Recusado'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          {tutor.email}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {tutor.country || (tutor as any).nativeCountry || (tutor as any).location || 'United States'}
                          {tutor.accent ? ` • ${tutor.accent}` : ''}
                        </span>
                        <span className="flex items-center gap-1 font-bold text-slate-700">
                          <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                          ${tutor.pricePerSessionUsd || (tutor as any).hourlyRateUsd || 15} USD / sessão
                        </span>
                      </div>

                      {/* Bio */}
                      {tutor.bio && (
                        <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 mt-2 leading-relaxed">
                          {tutor.bio}
                        </p>
                      )}

                      {/* Specialties Chips */}
                      {Array.isArray(tutor?.specialties) && tutor.specialties.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          <span className="text-[10px] font-bold text-slate-400">
                            {isEn ? 'Focus:' : 'Especialidades:'}
                          </span>
                          {tutor.specialties.map((spec, sIdx) => (
                            <span
                              key={sIdx}
                              className="px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-200/70 text-indigo-800 text-[10px] font-bold"
                            >
                              {spec}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Google Meet & Video Intro */}
                      <div className="flex items-center gap-3 flex-wrap pt-1">
                        {tutor.meetUrl && (
                          <a
                            href={tutor.meetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg font-bold transition"
                          >
                            <Video className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Google Meet: {tutor.meetUrl}</span>
                            <ExternalLink className="w-3 h-3 text-emerald-500" />
                          </a>
                        )}

                        {tutor.videoIntroUrl && (
                          <a
                            href={tutor.videoIntroUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-[#1C4C96] hover:underline font-bold"
                          >
                            <Video className="w-3.5 h-3.5" />
                            <span>{isEn ? 'Watch presentation video' : 'Ver vídeo de apresentação'}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      {/* Availability & Applied Date */}
                      <div className="flex items-center gap-4 text-[11px] text-slate-400 pt-1 flex-wrap">
                        {tutor.availableDays && tutor.availableDays.length > 0 && (
                          <div className="flex items-center gap-1 text-slate-500">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            <span>
                              <strong>{isEn ? 'Available:' : 'Dias:'}</strong> {tutor.availableDays.join(', ')}
                            </span>
                          </div>
                        )}
                        {tutor.appliedAt && (
                          <span>
                            {isEn ? 'Applied:' : 'Cadastrado em:'}{' '}
                            {new Date(tutor.appliedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex sm:flex-col gap-2 w-full sm:w-auto shrink-0">
                    {status !== 'approved' && (
                      <button
                        type="button"
                        onClick={() => onApproveTutor(tutor.id, tutor)}
                        className="flex-1 sm:flex-initial px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <CheckCircle className="w-4 h-4" />
                        <span>{isEn ? 'Approve' : 'Aprovar'}</span>
                      </button>
                    )}

                    {status !== 'rejected' && (
                      <button
                        type="button"
                        onClick={() => onRejectTutor(tutor.id, tutor)}
                        className="flex-1 sm:flex-initial px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>{isEn ? 'Reject' : 'Recusar'}</span>
                      </button>
                    )}

                    {onDeleteTutor && (
                      confirmDeleteId === tutor.id ? (
                        <div className="flex flex-col gap-1.5 p-2 bg-rose-50 border border-rose-300 rounded-xl shadow-xs animate-fadeIn">
                          <span className="text-[11px] font-bold text-rose-800 text-center leading-tight">
                            {isEn ? 'Permanently delete?' : 'Confirmar exclusão?'}
                          </span>
                          <div className="flex items-center gap-1.5 justify-center">
                            <button
                              type="button"
                              disabled={deletingId === tutor.id}
                              onClick={async () => {
                                setDeletingId(tutor.id);
                                try {
                                  await onDeleteTutor(tutor.id, tutor.email);
                                  setActionNotification(
                                    isEn
                                      ? `Native friend "${tutor.name}" was permanently deleted.`
                                      : `Amigo Nativo "${tutor.name}" excluído com sucesso.`
                                  );
                                  setTimeout(() => setActionNotification(null), 4000);
                                } finally {
                                  setDeletingId(null);
                                  setConfirmDeleteId(null);
                                }
                              }}
                              className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-black transition flex items-center gap-1 shadow-sm cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>
                                {deletingId === tutor.id
                                  ? (isEn ? 'Deleting...' : 'Excluindo...')
                                  : (isEn ? 'Yes, delete' : 'Sim, excluir')}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === tutor.id}
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold transition cursor-pointer"
                            >
                              {isEn ? 'Cancel' : 'Cancelar'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(tutor.id)}
                          className="flex-1 sm:flex-initial px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                          title={isEn ? 'Delete tutor from system' : 'Excluir Amigo Nativo do sistema'}
                        >
                          <Trash2 className="w-4 h-4 text-rose-600" />
                          <span>{isEn ? 'Delete' : 'Excluir'}</span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
