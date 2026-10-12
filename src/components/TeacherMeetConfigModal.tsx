import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Settings,
  Video,
  Clock,
  Globe,
  Calendar,
  Save,
  Check,
  Copy,
  Trash2,
  CheckSquare,
} from 'lucide-react';
import { TeacherMeetSettings, DayOfWeek, Language, NativeFriendTutor } from '../types';
import {
  TIMEZONE_OPTIONS,
  DEFAULT_TEACHER_TIMEZONE,
  getDefaultTimezoneForCountry,
  generate30MinTimeSlots,
  FIXED_30MIN_AVAILABILITY_SLOTS,
  DEFAULT_TEACHER_AVAILABILITY_HOURS,
  formatTimeSlot12h,
  parseTimeSlotTo24h,
  getTimezoneDisplayLabel,
} from '../utils/timezone';

export interface TeacherMeetConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  teacherEmail: string;
  teacherUid?: string;
  currentSettings?: TeacherMeetSettings;
  tutorProfile?: NativeFriendTutor | null;
  onSave: (settings: TeacherMeetSettings) => void;
  currentLanguage?: Language;
}

export const ALL_DAYS: { id: DayOfWeek; labelEn: string; fullEn: string }[] = [
  { id: 'monday', labelEn: 'Mon', fullEn: 'Monday' },
  { id: 'tuesday', labelEn: 'Tue', fullEn: 'Tuesday' },
  { id: 'wednesday', labelEn: 'Wed', fullEn: 'Wednesday' },
  { id: 'thursday', labelEn: 'Thu', fullEn: 'Thursday' },
  { id: 'friday', labelEn: 'Fri', fullEn: 'Friday' },
  { id: 'saturday', labelEn: 'Sat', fullEn: 'Saturday' },
  { id: 'sunday', labelEn: 'Sun', fullEn: 'Sunday' },
];

export interface TimePeriodGroup {
  id: 'overnight' | 'morning' | 'afternoon' | 'evening';
  label: string;
  range12h: string;
  iconText: string;
  slots: string[];
}

export const TIME_PERIOD_GROUPS: TimePeriodGroup[] = [
  {
    id: 'overnight',
    label: 'Overnight & Early Morning',
    range12h: '12:00 AM – 07:30 AM',
    iconText: '🌙',
    slots: generate30MinTimeSlots('00:00', '08:00'),
  },
  {
    id: 'morning',
    label: 'Morning',
    range12h: '08:00 AM – 11:30 AM',
    iconText: '☀️',
    slots: generate30MinTimeSlots('08:00', '12:00'),
  },
  {
    id: 'afternoon',
    label: 'Afternoon',
    range12h: '12:00 PM – 05:30 PM',
    iconText: '🌤️',
    slots: generate30MinTimeSlots('12:00', '18:00'),
  },
  {
    id: 'evening',
    label: 'Evening & Late Night',
    range12h: '06:00 PM – 11:30 PM',
    iconText: '🌆',
    slots: generate30MinTimeSlots('18:00', '24:00'),
  },
];

function getInitialAvailability(settings?: TeacherMeetSettings): Record<DayOfWeek, string[]> {
  const defaultSlots =
    settings?.availableHours && settings.availableHours.length > 0
      ? settings.availableHours.map(parseTimeSlotTo24h)
      : DEFAULT_TEACHER_AVAILABILITY_HOURS;

  const legacyDays = settings?.availableDays || [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];

  const sourceMap = settings?.availability || settings?.availableHoursByDay || {};

  const result: Record<DayOfWeek, string[]> = {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };

  ALL_DAYS.forEach((d) => {
    if (sourceMap[d.id] && Array.isArray(sourceMap[d.id])) {
      result[d.id] = [...sourceMap[d.id]].map(parseTimeSlotTo24h).sort();
    } else if (legacyDays.includes(d.id)) {
      result[d.id] = [...defaultSlots].map(parseTimeSlotTo24h).sort();
    } else {
      result[d.id] = [];
    }
  });

  return result;
}

export const TeacherMeetConfigModal: React.FC<TeacherMeetConfigModalProps> = ({
  isOpen,
  onClose,
  teacherEmail,
  teacherUid,
  currentSettings,
  tutorProfile,
  onSave,
  currentLanguage = 'en',
}) => {
  // Resolve correct teacher timezone:
  // 1. tutorProfile?.timezone (what the native friend informed when signing up on the platform)
  // 2. currentSettings?.timezone (if already configured and not an accidental Brazil fallback for a native teacher)
  // 3. Auto-detected from country/accent informed when signing up (e.g. Canada -> America/Toronto, USA -> America/New_York, UK -> Europe/London)
  // 4. DEFAULT_TEACHER_TIMEZONE ('America/Toronto')
  const resolveInitialTimezone = useCallback((): string => {
    if (tutorProfile?.timezone && tutorProfile.timezone.trim()) {
      return tutorProfile.timezone.trim();
    }
    if (currentSettings?.timezone && currentSettings.timezone.trim()) {
      const isBrazilian =
        (tutorProfile?.country || '').toLowerCase().includes('brazil') ||
        (tutorProfile?.country || '').toLowerCase().includes('brasil');

      if (
        currentSettings.timezone === 'America/Sao_Paulo' &&
        !isBrazilian &&
        (tutorProfile?.country || tutorProfile?.accent)
      ) {
        return getDefaultTimezoneForCountry(tutorProfile?.country, tutorProfile?.accent);
      }
      return currentSettings.timezone.trim();
    }
    if (tutorProfile?.country || tutorProfile?.accent) {
      return getDefaultTimezoneForCountry(tutorProfile.country, tutorProfile.accent);
    }
    return DEFAULT_TEACHER_TIMEZONE;
  }, [tutorProfile, currentSettings]);

  const [meetLink, setMeetLink] = useState<string>(
    currentSettings?.meetLink || tutorProfile?.meetUrl || ''
  );
  const [timezone, setTimezone] = useState<string>(resolveInitialTimezone);
  const [activeDay, setActiveDay] = useState<DayOfWeek>('monday');
  const [availabilityByDay, setAvailabilityByDay] = useState<Record<DayOfWeek, string[]>>(() =>
    getInitialAvailability(currentSettings)
  );
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Sync state whenever modal opens or settings/profile change
  useEffect(() => {
    if (isOpen) {
      setMeetLink(currentSettings?.meetLink || tutorProfile?.meetUrl || '');
      setTimezone(resolveInitialTimezone());
      setAvailabilityByDay(getInitialAvailability(currentSettings));
      setSavedSuccess(false);
      setActionNotice(null);
    }
  }, [isOpen, currentSettings, tutorProfile, resolveInitialTimezone]);

  // Support ESC key to dismiss
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

  const activeDayObj = ALL_DAYS.find((d) => d.id === activeDay) || ALL_DAYS[0];
  const activeDaySlots = availabilityByDay[activeDay] || [];
  const activeDayHours = ((activeDaySlots.length * 30) / 60).toFixed(1);

  // Active days count & total weekly hours
  const activeDaysCount = ALL_DAYS.filter((d) => (availabilityByDay[d.id] || []).length > 0).length;
  const totalWeeklySlots = ALL_DAYS.reduce(
    (acc, day) => acc + (availabilityByDay[day.id]?.length || 0),
    0
  );
  const totalWeeklyHours = ((totalWeeklySlots * 30) / 60).toFixed(1);

  // Toggle a single 30-min slot for active day
  const toggleSlotForActiveDay = (slot: string) => {
    setAvailabilityByDay((prev) => {
      const currentSlots = prev[activeDay] || [];
      const updated = currentSlots.includes(slot)
        ? currentSlots.filter((s) => s !== slot)
        : [...currentSlots, slot].sort();
      return {
        ...prev,
        [activeDay]: updated,
      };
    });
  };

  // Select all 48 slots for the active day
  const handleSelectAllForActiveDay = () => {
    setAvailabilityByDay((prev) => ({
      ...prev,
      [activeDay]: [...FIXED_30MIN_AVAILABILITY_SLOTS],
    }));
    setActionNotice(`All 48 slots selected for ${activeDayObj.fullEn}`);
    setTimeout(() => setActionNotice(null), 2000);
  };

  // Clear all slots for active day
  const handleClearActiveDay = () => {
    setAvailabilityByDay((prev) => ({
      ...prev,
      [activeDay]: [],
    }));
    setActionNotice(`${activeDayObj.fullEn} marked as off`);
    setTimeout(() => setActionNotice(null), 2000);
  };

  // Copy schedule from active day to Mon-Fri or All 7 Days
  const copyActiveDaySchedule = (scope: 'weekdays' | 'all') => {
    const slotsToCopy = [...(availabilityByDay[activeDay] || [])];
    setAvailabilityByDay((prev) => {
      const next = { ...prev };
      ALL_DAYS.forEach((d) => {
        if (scope === 'weekdays') {
          if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(d.id)) {
            next[d.id] = [...slotsToCopy];
          }
        } else {
          next[d.id] = [...slotsToCopy];
        }
      });
      return next;
    });

    const msg =
      scope === 'weekdays'
        ? `Applied ${activeDayObj.labelEn} schedule to Mon–Fri!`
        : `Applied ${activeDayObj.labelEn} schedule to all 7 days!`;
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 2200);
  };

  // Save to backend & Firestore
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const activeDaysList = ALL_DAYS.map((d) => d.id).filter(
      (dayId) => (availabilityByDay[dayId] || []).length > 0
    );

    const allSlotsSet = new Set<string>();
    ALL_DAYS.forEach((d) => {
      const slots = availabilityByDay[d.id] || [];
      slots.forEach((s) => allSlotsSet.add(s));
    });
    const unionSlots = Array.from(allSlotsSet).sort();

    const startHour = unionSlots[0] || '08:00';
    const lastSlot = unionSlots[unionSlots.length - 1] || '18:00';
    const [h, m] = lastSlot.split(':').map(Number);
    const endMin = (isNaN(h) ? 18 : h) * 60 + (isNaN(m) ? 0 : m) + 30;
    const endHour = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(
      endMin % 60
    ).padStart(2, '0')}`;

    const updatedSettings: TeacherMeetSettings = {
      teacherEmail: teacherEmail.trim().toLowerCase(),
      uid: teacherUid || currentSettings?.uid,
      meetLink: meetLink.trim(),
      workingHoursStart: startHour,
      workingHoursEnd: endHour,
      slotDurationMinutes: 30,
      availableDays: activeDaysList,
      availableHours: availabilityByDay[activeDay] || unionSlots,
      availability: availabilityByDay,
      availableHoursByDay: availabilityByDay,
      timezone,
      updatedAt: new Date().toISOString(),
    };

    onSave(updatedSettings);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1000);
  };

  const isAllSelected = activeDaySlots.length === FIXED_30MIN_AVAILABILITY_SLOTS.length;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#000035]/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      id="teacher-meet-config-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-[#607EC9]/30 overflow-hidden my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in duration-200"
        id="teacher-meet-config-modal-container"
      >
        {/* Header */}
        <div
          className="px-6 py-4 bg-gradient-to-r from-[#000035] via-[#062863] to-[#1C4C96] text-white flex items-center justify-between border-b border-[#607EC9]/40 shrink-0"
          id="teacher-meet-config-modal-header"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1C4C96] flex items-center justify-center text-white shadow-xs border border-[#9AB4FF]/50">
              <Settings className="w-5 h-5 text-[#F4CA54]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-black text-base sm:text-lg text-white">
                  Native Friend Schedule & Setup
                </h3>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#1C4C96]/70 text-[#F4CA54] border border-[#9AB4FF]/30 flex items-center gap-1">
                  <Globe className="w-3 h-3 text-[#F4CA54]" />
                  <span>{getTimezoneDisplayLabel(timezone, 'en')}</span>
                </span>
              </div>
              <p className="text-xs text-[#9AB4FF] mt-0.5">{teacherEmail}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            id="close-teacher-meet-config-button"
            className="p-1.5 rounded-xl text-[#9AB4FF] hover:text-white hover:bg-white/10 transition cursor-pointer"
            aria-label="Close"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSave}
          className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1 text-xs sm:text-sm"
          id="teacher-meet-config-form"
        >
          {savedSuccess && (
            <div
              className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2 animate-in fade-in"
              id="teacher-settings-saved-success"
            >
              <Check className="w-4 h-4 text-emerald-600" />
              <span>Schedule and settings saved successfully!</span>
            </div>
          )}

          {actionNotice && (
            <div
              className="p-2.5 bg-[#9AB4FF]/20 border border-[#607EC9]/40 rounded-xl text-xs font-bold text-[#062863] flex items-center gap-2 animate-in fade-in"
              id="teacher-action-notice"
            >
              <Check className="w-4 h-4 text-[#1C4C96]" />
              <span>{actionNotice}</span>
            </div>
          )}

          {/* Top Row: Google Meet Link & Timezone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200">
            {/* Google Meet Link */}
            <div id="meet-link-field-group">
              <label className="block text-xs font-bold text-[#000035] mb-1 flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5 text-[#1C4C96]" />
                <span>Google Meet Room Link *</span>
              </label>
              <input
                type="url"
                required
                value={meetLink}
                onChange={(e) => setMeetLink(e.target.value)}
                placeholder="https://meet.google.com/..."
                id="teacher-meet-link-input"
                className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
              />
            </div>

            {/* Timezone Dropdown */}
            <div id="timezone-field-group">
              <label className="block text-xs font-bold text-[#000035] mb-1 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-[#1C4C96]" />
                <span>Timezone (Fuso Horário) *</span>
              </label>
              <div className="relative">
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  id="teacher-timezone-select"
                  className="w-full p-2 bg-white border border-slate-300 rounded-xl text-xs text-[#000035] focus:ring-2 focus:ring-[#1C4C96]"
                >
                  {TIMEZONE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.offset})
                    </option>
                  ))}
                  {timezone && !TIMEZONE_OPTIONS.some((opt) => opt.value === timezone) && (
                    <option key={timezone} value={timezone}>
                      {timezone}
                    </option>
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* Weekday Selector (7 Tabs) */}
          <div className="space-y-2" id="available-teaching-days-section">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#000035] flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#1C4C96]" />
                <span>Weekly Schedule</span>
              </span>
              <span className="text-[11px] font-bold text-slate-500">
                {activeDaysCount} of 7 days active • {totalWeeklyHours}h/week
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1.5" id="day-selector-buttons-grid">
              {ALL_DAYS.map((day) => {
                const isCurrentActive = activeDay === day.id;
                const slotCount = (availabilityByDay[day.id] || []).length;
                const isDayEnabled = slotCount > 0;

                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => setActiveDay(day.id)}
                    id={`day-tab-${day.id}`}
                    className={`py-2 px-1 text-center rounded-2xl text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 cursor-pointer border ${
                      isCurrentActive
                        ? 'bg-[#000035] text-white border-[#000035] shadow-md ring-2 ring-[#1C4C96]/40'
                        : isDayEnabled
                        ? 'bg-[#1C4C96]/10 text-[#000035] border-[#1C4C96]/30 hover:border-[#1C4C96]'
                        : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-xs font-black tracking-tight">{day.labelEn}</span>
                    <span
                      className={`text-[10px] font-semibold px-1 rounded-full ${
                        isCurrentActive
                          ? 'bg-[#F4CA54] text-[#000035] font-black'
                          : isDayEnabled
                          ? 'text-[#1C4C96] font-bold'
                          : 'text-slate-400'
                      }`}
                    >
                      {isDayEnabled ? `${slotCount}` : 'Off'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Day Action Toolbar (Clean & Minimal UX) */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#1C4C96]" />
              <span className="text-xs text-slate-700">
                Editing <strong className="text-[#000035] font-black">{activeDayObj.fullEn}</strong>:{' '}
                <span className="font-bold text-[#1C4C96]">
                  {activeDaySlots.length} slots ({activeDayHours}h)
                </span>
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Select All */}
              <button
                type="button"
                onClick={handleSelectAllForActiveDay}
                id="select-all-day-slots-btn"
                className="px-2.5 py-1.5 bg-white hover:bg-[#1C4C96]/10 text-[#1C4C96] border border-[#1C4C96]/30 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                title="Select all 48 slots for this day"
              >
                <CheckSquare className="w-3.5 h-3.5 text-[#1C4C96]" />
                <span>Select All</span>
              </button>

              {/* Clear Day */}
              <button
                type="button"
                onClick={handleClearActiveDay}
                id="clear-day-slots-btn"
                className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                title="Clear all slots for this day"
              >
                <Trash2 className="w-3.5 h-3.5 text-slate-500" />
                <span>Clear Day</span>
              </button>

              <div className="w-px h-4 bg-slate-200 mx-0.5 hidden sm:block" />

              {/* Copy to Mon-Fri */}
              <button
                type="button"
                onClick={() => copyActiveDaySchedule('weekdays')}
                id="copy-to-weekdays-btn"
                className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                title="Apply this day's schedule to Monday through Friday"
              >
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                <span>Copy to Mon–Fri</span>
              </button>

              {/* Copy to All Days */}
              <button
                type="button"
                onClick={() => copyActiveDaySchedule('all')}
                id="copy-to-all-days-btn"
                className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                title="Apply this day's schedule to all 7 days"
              >
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                <span>Copy to All Days</span>
              </button>
            </div>
          </div>

          {/* Continuous Time Slots Grid (12:00 AM to 11:30 PM in 30-min intervals) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-bold flex items-center gap-1 text-[#000035]">
                <Clock className="w-3.5 h-3.5 text-[#1C4C96]" />
                <span>30-Minute Time Slots (12:00 AM – 11:30 PM)</span>
              </span>
              <span>Click to toggle slot availability</span>
            </div>

            <div
              className="p-3 bg-slate-50/50 rounded-2xl border border-slate-200 max-h-72 overflow-y-auto pr-1"
              id="continuous-slots-container"
            >
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {FIXED_30MIN_AVAILABILITY_SLOTS.map((slot) => {
                  const isSelected = activeDaySlots.includes(slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => toggleSlotForActiveDay(slot)}
                      id={`slot-btn-${activeDay}-${slot.replace(':', '-')}`}
                      title={`${formatTimeSlot12h(slot)} (${slot})`}
                      className={`py-2 px-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer border whitespace-nowrap ${
                        isSelected
                          ? 'bg-[#1C4C96] text-white border-[#1C4C96] shadow-2xs ring-1 ring-[#1C4C96]/30'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {isSelected ? (
                        <Check className="w-3.5 h-3.5 text-[#F4CA54] shrink-0 stroke-[3]" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                      )}
                      <span className="tracking-tight">{formatTimeSlot12h(slot)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer Save Actions */}
          <div
            className="pt-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200 shrink-0"
            id="teacher-meet-config-footer"
          >
            <span className="text-xs text-slate-500 font-medium self-start sm:self-auto">
              Total weekly commitment:{' '}
              <strong className="text-[#000035]">{totalWeeklyHours} hours</strong> ({totalWeeklySlots}{' '}
              slots)
            </span>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={onClose}
                id="cancel-teacher-config-button"
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                id="save-teacher-availability-button"
                className="px-5 py-2 bg-[#000035] hover:bg-[#1C4C96] text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-md cursor-pointer"
              >
                <Save className="w-4 h-4 text-[#F4CA54]" />
                <span>Save Availability & Settings</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
