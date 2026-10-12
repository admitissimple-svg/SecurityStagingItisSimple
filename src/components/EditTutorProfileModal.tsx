import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Save,
  Check,
  Video,
  DollarSign,
  MapPin,
  Globe,
  Sparkles,
} from 'lucide-react';
import { NativeFriendTutor, Language } from '../types';
import { ImageUploadInput } from './ImageUploadInput';
import {
  TIMEZONE_OPTIONS,
  DEFAULT_TEACHER_TIMEZONE,
  getDefaultTimezoneForCountry,
} from '../utils/timezone';
import { extractYouTubeVideoId } from '../utils/youtube';

interface EditTutorProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  tutor?: NativeFriendTutor | null;
  onSave: (updated: NativeFriendTutor) => void;
  currentLanguage: Language;
}

const COUNTRY_OPTIONS = [
  { name: 'Canada', flag: '🇨🇦', code: 'CA' },
  { name: 'United States', flag: '🇺🇸', code: 'US' },
  { name: 'United Kingdom', flag: '🇬🇧', code: 'GB' },
  { name: 'South Africa', flag: '🇿🇦', code: 'ZA' },
  { name: 'Ireland', flag: '🇮🇪', code: 'IE' },
  { name: 'Australia', flag: '🇦🇺', code: 'AU' },
  { name: 'New Zealand', flag: '🇳🇿', code: 'NZ' },
];

export const EditTutorProfileModal: React.FC<EditTutorProfileModalProps> = ({
  isOpen,
  onClose,
  tutor,
  onSave,
  currentLanguage,
}) => {
  const [formData, setFormData] = useState<Partial<NativeFriendTutor>>(() => ({
    ...(tutor || {}),
  }));
  const [specialtiesText, setSpecialtiesText] = useState(
    (tutor?.specialties || []).join(', ')
  );
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Synchronize state whenever modal is opened or tutor changes
  useEffect(() => {
    if (isOpen && tutor) {
      setFormData({ ...tutor });
      setSpecialtiesText((tutor.specialties || []).join(', '));
    }
  }, [isOpen, tutor]);

  // Support ESC key to easily dismiss the tutor profile modal
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

  if (!isOpen || !tutor) return null;

  const handleChange = (field: keyof NativeFriendTutor, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleCountryChange = (countryName: string) => {
    const found = COUNTRY_OPTIONS.find((c) => c.name === countryName);
    const newFlag = found?.flag || formData.flag || '🌐';
    const newCode = found?.code || formData.countryCode || 'US';
    const suggestedTz = getDefaultTimezoneForCountry(countryName, formData.accent);

    setFormData((prev) => ({
      ...prev,
      country: countryName,
      flag: newFlag,
      countryCode: newCode,
      timezone: prev.timezone || suggestedTz,
    }));
  };

  const currentUsdPrice = Number(formData.pricePerSessionUsd) || tutor.pricePerSessionUsd || 15;
  const calculatedBrlPrice = Math.round(currentUsdPrice * 5.5);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanVideoLink = (formData.videoIntroUrl || (formData as any).videoUrl || (formData as any).introVideoUrl || (formData as any).youtubeUrl || '').trim();
    const extractedEmbedId = extractYouTubeVideoId(cleanVideoLink);

    const updated: NativeFriendTutor = {
      ...(tutor as NativeFriendTutor),
      ...formData,
      videoIntroUrl: cleanVideoLink,
      youtubeUrl: cleanVideoLink,
      videoUrl: cleanVideoLink,
      introVideoUrl: cleanVideoLink,
      youtubeEmbedId: extractedEmbedId || '',
      // Strictly preserve schedule and meet link from tutor / centralized settings
      meetUrl: tutor.meetUrl || (tutor as any).meetLink || '',
      availableDays: tutor.availableDays || [],
      availability: tutor.availability || (tutor as any).availableHoursByDay,
      pricePerSessionUsd: currentUsdPrice,
      pricePerSessionBrl: calculatedBrlPrice,
      specialties: specialtiesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    onSave(updated);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1000);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#000035]/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      id="edit-tutor-profile-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-[#607EC9]/40 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-[#000035] via-[#062863] to-[#1C4C96] text-white flex items-center justify-between border-b border-[#607EC9]/40 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#1C4C96] text-[#F4CA54] flex items-center justify-center font-black shadow-md border border-[#9AB4FF]/50">
              <User className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-white">
                Edit My Public Profile & Presentation
              </h2>
              <p className="text-xs text-[#9AB4FF]">
                Update your bio, photo, hourly rate, specialties, and video presentation.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-white/10 transition cursor-pointer"
            aria-label="Close"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {savedSuccess && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-2xl text-xs font-bold text-emerald-800 flex items-center gap-2 animate-in fade-in">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>Profile updated successfully! All changes are synced.</span>
            </div>
          )}

          {/* 1. Profile Photo Upload */}
          <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200">
            <ImageUploadInput
              label="Profile Photo / Avatar (Upload from device or choose)"
              value={formData.avatar}
              onChange={(newAvatar) => handleChange('avatar', newAvatar)}
              currentLanguage="en"
              helperText="Your photo will be showcased on the Native Friends catalog and live session bookings."
            />
          </div>

          {/* 2. Personal & Public Presentation Details (6 balanced fields across 2 columns) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Display Name *
              </label>
              <input
                type="text"
                required
                value={formData.name || ''}
                onChange={(e) => handleChange('name', e.target.value)}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Headline / Catchphrase *
              </label>
              <input
                type="text"
                required
                value={formData.headline || ''}
                onChange={(e) => handleChange('headline', e.target.value)}
                placeholder="e.g. Native New Yorker • Daily Conversation"
                className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Price per 50-min Session (USD) *
              </label>
              <div className="relative">
                <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="number"
                  min="5"
                  max="200"
                  required
                  value={formData.pricePerSessionUsd ?? 15}
                  onChange={(e) => handleChange('pricePerSessionUsd', Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-semibold">
                Per 50-minute individual conversation session (1st trial lesson is 25 min free)
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Accent / Origin Description
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={formData.accent || ''}
                  onChange={(e) => handleChange('accent', e.target.value)}
                  placeholder="e.g. North American (Canadian/Toronto)"
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Native Country
              </label>
              <div className="relative">
                <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={formData.country || ''}
                  onChange={(e) => handleCountryChange(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                >
                  <option value="">Select country...</option>
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.flag} {c.name}
                    </option>
                  ))}
                  {formData.country && !COUNTRY_OPTIONS.some((c) => c.name === formData.country) && (
                    <option value={formData.country}>
                      {formData.flag || '🌐'} {formData.country}
                    </option>
                  )}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Timezone (Fuso Horário) *
              </label>
              <div className="relative">
                <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={formData.timezone || DEFAULT_TEACHER_TIMEZONE}
                  onChange={(e) => handleChange('timezone', e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                >
                  {TIMEZONE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.offset})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 3. Specialties, Video Presentation & Biography (Harmonic transition with clear section demarcation) */}
          <div className="pt-3 border-t border-slate-200/80 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#1C4C96]" />
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                  Specialties & Video Presentation
                </h3>
              </div>
              <span className="text-[11px] text-slate-400 font-medium">
                Showcased on your public student card
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#F4CA54]" />
                  <span>Specialties (separated by comma)</span>
                </label>
                <input
                  type="text"
                  value={specialtiesText}
                  onChange={(e) => setSpecialtiesText(e.target.value)}
                  placeholder="e.g. Daily Habits, Accent Polish, Business Confidence"
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Video Introduction Link (YouTube / Vimeo / Loom)
                </label>
                <div className="relative">
                  <Video className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="url"
                    value={formData.videoIntroUrl || ''}
                    onChange={(e) => handleChange('videoIntroUrl', e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Biography & Presentation *
              </label>
              <textarea
                rows={4}
                required
                value={formData.bio || ''}
                onChange={(e) => handleChange('bio', e.target.value)}
                placeholder="Tell students about yourself and your approach to practicing English through daily routines..."
                className="w-full p-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
              />
            </div>
          </div>

          {/* Footer Save */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="px-6 py-2.5 bg-[#000035] hover:bg-[#1C4C96] text-white rounded-xl text-xs font-black transition cursor-pointer shadow-md flex items-center gap-2"
            >
              <Save className="w-4 h-4 text-[#F4CA54]" />
              <span>Save Presentation</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

