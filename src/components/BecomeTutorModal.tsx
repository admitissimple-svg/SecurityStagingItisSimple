import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  Globe,
  Sparkles,
  DollarSign,
  Calendar,
  Video,
  User,
  Mail,
  Send,
  Heart,
} from 'lucide-react';
import { Language, DayOfWeek } from '../types';
import { ImageUploadInput } from './ImageUploadInput';
import { TIMEZONE_OPTIONS, getDefaultTimezoneForCountry } from '../utils/timezone';
import { extractYouTubeVideoId } from '../utils/youtube';
import { doc, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';

interface BecomeTutorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLanguage?: Language;
  onRegisteredSuccess?: (tutorData: any) => void;
  onRegisterSuccess?: (tutorData: any) => void;
}

export const BecomeTutorModal: React.FC<BecomeTutorModalProps> = ({
  isOpen,
  onClose,
  onRegisteredSuccess,
  onRegisterSuccess,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    avatar: '',
    country: '',
    accent: '',
    nativeLanguage: '',
    headline: '',
    bio: '',
    videoUrl: '',
    priceUsd: '',
    meetUrl: '',
    timezone: 'America/Toronto',
    availableDays: [] as DayOfWeek[],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emailWarning, setEmailWarning] = useState<string | null>(null);
  const [nameWarning, setNameWarning] = useState<string | null>(null);
  const [lastCreatedTutor, setLastCreatedTutor] = useState<any>(null);

  // Support ESC key to easily dismiss the initial registration modal
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

  const checkEmailExists = async (emailToCheck: string) => {
    const clean = emailToCheck.trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      setEmailWarning(null);
      return;
    }
    try {
      const res = await fetch(`/api/auth/check-user?email=${encodeURIComponent(clean)}&role=teacher`);
      if (res.ok) {
        const data = await res.json();
        if (data.emailExists) {
          setEmailWarning(`This email is already registered (${clean}). Please log in or use another email.`);
        } else {
          setEmailWarning(null);
        }
      }
    } catch {
      // ignore
    }
  };

  const checkNameExists = async (nameToCheck: string) => {
    const clean = nameToCheck.trim();
    if (!clean || clean.length < 3) {
      setNameWarning(null);
      return;
    }
    try {
      const res = await fetch(`/api/auth/check-user?name=${encodeURIComponent(clean)}&role=teacher`);
      if (res.ok) {
        const data = await res.json();
        if (data.nameExists) {
          setNameWarning(`A Native Friend with the name "${clean}" already exists. Please include your surname.`);
        } else {
          setNameWarning(null);
        }
      }
    } catch {
      // ignore
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailWarning || nameWarning) {
      setErrorMessage(emailWarning || nameWarning);
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const cleanVideoLink = (formData.videoUrl || '').trim();
      const extractedEmbedId = extractYouTubeVideoId(cleanVideoLink);

      // Register with backend
      const tutorPayload = {
        name: formData.name.trim(),
        email: formData.email.toLowerCase().trim(),
        avatar: formData.avatar || '',
        role: 'teacher',
        country: formData.country,
        accent: formData.accent,
        headline: formData.headline,
        bio: formData.bio,
        videoIntroUrl: cleanVideoLink,
        youtubeUrl: cleanVideoLink,
        videoUrl: cleanVideoLink,
        introVideoUrl: cleanVideoLink,
        youtubeEmbedId: extractedEmbedId || '',
        pricePerSessionUsd: Number(formData.priceUsd) || 20,
        pricePerSessionBrl: Math.round((Number(formData.priceUsd) || 20) * 5.5),
        availableDays: formData.availableDays,
        timezone: formData.timezone || 'America/Toronto',
        approvalStatus: 'pending',
        isApproved: false,
        status: 'pending',
        approved: false,
        registeredByAdmin: false,
      };

      const res = await fetch('/api/tutors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutor: tutorPayload }),
      });

      const resData = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErrorMessage(resData.error || 'Erro ao realizar cadastro de Amigo Nativo.');
        return;
      }

      const createdTutor = resData.tutor || tutorPayload;

      // Direct Cloud Firestore persistence for /tutors/{tutorId}, /users/{cleanDocId}, and /teacher_availability/
      try {
        const firestore = getDb();
        const cleanTutorId = createdTutor.id || `tutor-${tutorPayload.email.replace(/[^a-zA-Z0-9]/g, '-')}`;
        const cleanDocEmail = tutorPayload.email.replace(/[^a-zA-Z0-9]/g, '-');
        await Promise.all([
          setDoc(doc(firestore, 'users', cleanTutorId), {
            ...createdTutor,
            id: cleanTutorId,
            email: tutorPayload.email,
            role: 'teacher',
            updatedAt: new Date().toISOString(),
          }, { merge: true }),
          setDoc(doc(firestore, 'tutors', cleanTutorId), {
            ...createdTutor,
            id: cleanTutorId,
            email: tutorPayload.email,
            role: 'teacher',
            updatedAt: new Date().toISOString(),
          }, { merge: true }),
          setDoc(doc(firestore, 'users', cleanDocEmail), {
            email: tutorPayload.email,
            name: tutorPayload.name,
            role: 'teacher',
            country: tutorPayload.country,
            timezone: tutorPayload.timezone,
            avatar: tutorPayload.avatar,
            updatedAt: new Date().toISOString(),
          }, { merge: true }),
          setDoc(doc(firestore, 'teacher_availability', cleanDocEmail), {
            teacherEmail: tutorPayload.email,
            meetLink: formData.meetUrl,
            workingHoursStart: '08:00',
            workingHoursEnd: '18:00',
            slotDurationMinutes: 30,
            availableDays: formData.availableDays,
            timezone: formData.timezone || 'America/Toronto',
            updatedAt: new Date().toISOString(),
          }, { merge: true }),
        ]);
      } catch (fsErr) {
        console.warn('Direct Firestore registration sync notice:', fsErr);
      }

      // Save meet settings
      await fetch('/api/meet-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherEmail: formData.email.toLowerCase().trim(),
          settings: {
            meetLink: formData.meetUrl,
            workingHoursStart: '08:00',
            workingHoursEnd: '18:00',
            slotDurationMinutes: 30,
            availableDays: formData.availableDays,
            timezone: formData.timezone || 'America/Toronto',
          },
        }),
      });

      setIsSubmitted(true);
      setLastCreatedTutor(createdTutor);
      const callback = onRegisteredSuccess || onRegisterSuccess;
      if (callback) {
        callback(createdTutor);
      }
    } catch (err: any) {
      console.error('Error registering tutor:', err);
      setErrorMessage('Falha ao conectar com o servidor. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleDay = (day: DayOfWeek) => {
    setFormData((prev) => ({
      ...prev,
      availableDays: prev.availableDays.includes(day)
        ? prev.availableDays.filter((d) => d !== day)
        : [...prev.availableDays, day],
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl max-w-2xl sm:max-w-3xl w-full shadow-2xl border border-[#607EC9]/30 relative my-auto max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        {isSubmitted ? (
          <div className="p-6 sm:p-8 flex-1 overflow-y-auto custom-scrollbar flex flex-col items-center justify-center text-center space-y-4 relative">
            <button
              type="button"
              onClick={onClose}
              className="absolute top-5 right-5 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 hover:text-slate-900 transition cursor-pointer z-10"
              aria-label="Close"
              title="Fechar (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <h3 className="text-2xl font-black text-[#000035]">
              Application Submitted Successfully!
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
              Thank you for applying to become a Native Friend! Your profile has been sent for administrative review. Once approved, your profile will be published on the platform for students to book sessions.
            </p>
            <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl text-xs text-[#062863] max-w-md mx-auto">
              <p className="font-bold">
                Status: Pending Administrator Review
              </p>
            </div>
            <div className="pt-4">
              <button
                type="button"
                onClick={() => {
                  const callback = onRegisteredSuccess || onRegisterSuccess;
                  if (callback && lastCreatedTutor) {
                    callback(lastCreatedTutor);
                  }
                  onClose();
                }}
                className="px-6 py-2.5 rounded-xl bg-[#062863] text-white hover:bg-[#000035] font-bold text-sm shadow-xs transition cursor-pointer"
              >
                Done / Back to Home
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Fixed Header */}
            <div className="shrink-0 p-5 sm:p-6 pb-4 bg-white border-b border-slate-100 relative z-10">
              <button
                type="button"
                onClick={onClose}
                className="absolute top-5 right-5 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 hover:text-slate-900 transition cursor-pointer z-20"
                aria-label="Close"
                title="Fechar (Esc)"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Header Title & Description */}
              <div className="space-y-1 mb-4 pr-10">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#062863]/10 text-[#062863] text-xs font-bold">
                  <Sparkles className="w-3.5 h-3.5 text-[#1C4C96]" />
                  <span>Become a Native Friend</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-[#000035] tracking-tight">
                  Teach English by Living Life
                </h2>
                <p className="text-xs sm:text-sm text-slate-600">
                  No boring grammar textbooks. Connect with learners through practical, real-world conversation about daily routines and habits.
                </p>
              </div>

              {/* Fixed Stepper Tabs */}
              <div className="flex items-center justify-between text-xs font-bold pt-1">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className={`flex items-center gap-1.5 pb-1 border-b-2 transition cursor-pointer ${
                    step === 1
                      ? 'border-[#1C4C96] text-[#000035]'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[10px]">1</span>
                  <span>Personal Info</span>
                </button>

                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className={`flex items-center gap-1.5 pb-1 border-b-2 transition cursor-pointer ${
                    step === 2
                      ? 'border-[#1C4C96] text-[#000035]'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[10px]">2</span>
                  <span>Bio & Video Intro</span>
                </button>

                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className={`flex items-center gap-1.5 pb-1 border-b-2 transition cursor-pointer ${
                    step === 3
                      ? 'border-[#1C4C96] text-[#000035]'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[10px]">3</span>
                  <span>Schedule & Pricing</span>
                </button>
              </div>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 custom-scrollbar scrollbar-thin">
              {errorMessage && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2 animate-in fade-in">
                  <span className="font-bold shrink-0 text-sm leading-none">⚠️</span>
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Step 1: Personal info */}
              {step === 1 && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  <ImageUploadInput
                    label="Profile Photo / Avatar (Upload from device)"
                    value={formData.avatar}
                    onChange={(newAvatar) => setFormData({ ...formData, avatar: newAvatar })}
                    currentLanguage="en"
                    helperText="Upload a friendly, clear headshot photo for your Native Friend profile."
                  />

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => {
                        setFormData({ ...formData, name: e.target.value });
                        if (nameWarning) setNameWarning(null);
                      }}
                      onBlur={() => checkNameExists(formData.name)}
                      placeholder="Ex: Sarah Jenkins"
                      className={`w-full px-3.5 py-2 bg-slate-50 border rounded-xl text-sm text-[#000035] focus:bg-white focus:outline-hidden focus:ring-2 ${
                        nameWarning
                          ? 'border-amber-400 ring-2 ring-amber-400/20'
                          : 'border-[#607EC9]/30 focus:ring-[#1C4C96]'
                      }`}
                    />
                    {nameWarning && (
                      <p className="mt-1 text-xs text-amber-700 font-semibold bg-amber-50 p-2 rounded-lg border border-amber-200">
                        ⚠️ {nameWarning}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Email Address (Google/Gmail) *
                    </label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => {
                        setFormData({ ...formData, email: e.target.value });
                        if (emailWarning) setEmailWarning(null);
                      }}
                      onBlur={() => checkEmailExists(formData.email)}
                      placeholder="Ex: native.friend@gmail.com"
                      className={`w-full px-3.5 py-2 bg-slate-50 border rounded-xl text-sm text-[#000035] focus:bg-white focus:outline-hidden focus:ring-2 ${
                        emailWarning
                          ? 'border-rose-400 ring-2 ring-rose-400/20'
                          : 'border-[#607EC9]/30 focus:ring-[#1C4C96]'
                      }`}
                    />
                    {emailWarning && (
                      <p className="mt-1 text-xs text-rose-700 font-semibold bg-rose-50 p-2 rounded-lg border border-rose-200">
                        ⚠️ {emailWarning}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Native Country
                      </label>
                      <select
                        value={formData.country}
                        onChange={(e) => {
                          const country = e.target.value;
                          const autoTz = getDefaultTimezoneForCountry(country, formData.accent);
                          setFormData({ ...formData, country, timezone: autoTz });
                        }}
                        className="w-full px-3 py-2 bg-slate-50 border border-[#607EC9]/30 rounded-xl text-sm text-[#000035] focus:bg-white focus:outline-hidden"
                      >
                        <option value="">Select country...</option>
                        <option value="United States">🇺🇸 United States</option>
                        <option value="Canada">🇨🇦 Canada</option>
                        <option value="United Kingdom">🇬🇧 United Kingdom</option>
                        <option value="South Africa">🇿🇦 South Africa</option>
                        <option value="Ireland">🇮🇪 Ireland</option>
                        <option value="Australia">🇦🇺 Australia</option>
                        <option value="New Zealand">🇳🇿 New Zealand</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Accent / Region
                      </label>
                      <input
                        type="text"
                        value={formData.accent}
                        onChange={(e) => setFormData({ ...formData, accent: e.target.value })}
                        placeholder="Ex: North American"
                        className="w-full px-3 py-2 bg-slate-50 border border-[#607EC9]/30 rounded-xl text-sm text-[#000035] focus:bg-white"
                      />
                    </div>
                  </div>

                  <div className="pt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      disabled={!formData.name || !formData.email || Boolean(emailWarning) || Boolean(nameWarning)}
                      className="px-5 py-2.5 rounded-xl bg-[#062863] text-white hover:bg-[#000035] font-bold text-xs sm:text-sm disabled:opacity-50 cursor-pointer transition"
                    >
                      Next: Bio & Video Intro →
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Bio & Video */}
              {step === 2 && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Short Catchy Headline
                    </label>
                    <input
                      type="text"
                      value={formData.headline}
                      onChange={(e) => setFormData({ ...formData, headline: e.target.value })}
                      placeholder="Ex: Certified Canadian educator helping you master everyday conversation."
                      className="w-full px-3.5 py-2 bg-slate-50 border border-[#607EC9]/30 rounded-xl text-sm text-[#000035] focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      About You & Teaching Approach
                    </label>
                    <textarea
                      rows={3}
                      value={formData.bio}
                      onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                      placeholder="Ex: I love turning morning coffee and daily habits into natural English conversation..."
                      className="w-full px-3.5 py-2 bg-slate-50 border border-[#607EC9]/30 rounded-xl text-sm text-[#000035] focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      YouTube Video Intro Link (Optional)
                    </label>
                    <input
                      type="url"
                      value={formData.videoUrl}
                      onChange={(e) => setFormData({ ...formData, videoUrl: e.target.value })}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="w-full px-3.5 py-2 bg-slate-50 border border-[#607EC9]/30 rounded-xl text-sm text-[#000035] focus:bg-white"
                    />
                  </div>

                  <div className="pt-3 flex justify-between">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold text-xs cursor-pointer"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="px-5 py-2.5 rounded-xl bg-[#062863] text-white hover:bg-[#000035] font-bold text-xs sm:text-sm cursor-pointer transition"
                    >
                      Next: Schedule & Pricing →
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Rate & Availability */}
              {step === 3 && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Rate per Session (USD)
                      </label>
                      <div className="relative">
                        <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="number"
                          value={formData.priceUsd}
                          onChange={(e) => setFormData({ ...formData, priceUsd: e.target.value })}
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-[#607EC9]/30 rounded-xl text-sm font-bold text-[#000035]"
                        />
                      </div>
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        ≈ R$ {Math.round(Number(formData.priceUsd || 20) * 5.5)} BRL
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Default Google Meet Link
                      </label>
                      <input
                        type="url"
                        value={formData.meetUrl}
                        onChange={(e) => setFormData({ ...formData, meetUrl: e.target.value })}
                        placeholder="https://meet.google.com/..."
                        className="w-full px-3 py-2 bg-slate-50 border border-[#607EC9]/30 rounded-xl text-xs font-mono text-[#000035]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-[#1C4C96]" />
                      <span>Timezone (Fuso Horário do Amigo Nativo) *</span>
                    </label>
                    <div className="relative">
                      <select
                        value={formData.timezone}
                        onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-[#607EC9]/30 rounded-xl text-xs text-[#000035] focus:bg-white focus:outline-hidden"
                      >
                        {TIMEZONE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label} ({opt.offset})
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="text-[10px] text-slate-500 mt-1 block">
                      Detectado automaticamente pelo país de origem. Você pode alterar manualmente a qualquer momento.
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Available Days for Sessions
                    </label>
                    <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                      {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as DayOfWeek[]).map((d) => {
                        const isSelected = formData.availableDays.includes(d);
                        const label = d.substring(0, 3).toUpperCase();
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => toggleDay(d)}
                            className={`py-2 text-xs font-extrabold rounded-xl border transition cursor-pointer ${
                              isSelected
                                ? 'bg-[#062863] text-white border-[#062863]'
                                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-4 flex justify-between items-center border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold text-xs cursor-pointer"
                    >
                      ← Back
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm shadow-md transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                      <span>{isSubmitting ? 'Submitting Application...' : 'Complete Registration'}</span>
                    </button>
                  </div>
                </div>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
};
