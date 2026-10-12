import React, { useState } from 'react';
import {
  Youtube,
  Music,
  Headphones,
  Save,
  Check,
  Radio,
  Disc,
  Trash2,
  ExternalLink,
  User,
  Sparkles,
  Loader2,
  AlertCircle,
  ListVideo,
  CheckCircle2,
  ChevronDown,
  RotateCcw,
  AlertTriangle,
  Play,
  Volume2,
  Info,
  ShieldCheck,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import {
  RoutineItem,
  DayOfWeek,
  TeacherAssignedVideo,
  TeacherAssignedSpotify,
  Language,
  GoogleAccount,
} from '../types';
import { extractYouTubeVideoId, getDailyYouTubeVideoForStudent } from '../utils/youtube';
import { fetchDynamicYouTubePlaylists, DEFAULT_CURATED_PLAYLISTS } from '../utils/youtubeService';
import {
  isValidSpotifyUrl,
  parseSpotifyUrl,
  getSpotifyEmbedUrl,
  getDailySpotifyTrackForStudent,
  normalizeStudentLevel,
  getSpotifyPlaylistForLevel,
  getSpotifyContentType,
  getSpotifyDirectUrl,
  CORRUPT_SPOTIFY_IDS,
} from '../utils/spotify';
import { Translations, getActivityDisplayName } from '../utils/i18n';
import { defaultRoutinesByDay } from '../data/defaultRoutines';
import { NativeFriendSpotifyTable } from './NativeFriendSpotifyTable';
import { fetchWatchedVideosHistoryFromFirestore } from '../hooks/useRoutine';
import { getAccessToken } from '../utils/auth';
import { isValidCanonicalUid, normalizeWeekId, parseWeekCycleNumber } from '../utils/studentPersistence';

interface TeacherMediaAssignmentPanelProps {
  routinesByDay: Record<DayOfWeek, RoutineItem[]>;
  students: GoogleAccount[];
  selectedStudentEmail?: string;
  selectedStudentUid?: string;
  currentAccount?: GoogleAccount | null;
  onSelectStudentEmail?: (email: string) => void;
  onTeacherSaveVideos?: (
    activityId: string,
    videos: TeacherAssignedVideo[],
    teacherNotes?: string,
    replicateToAllDays?: boolean,
    targetDays?: DayOfWeek[],
    spotify?: TeacherAssignedSpotify | null,
    targetStudentEmail?: string,
    targetStudentUid?: string,
    activityName?: string
  ) => void;
  currentLanguage: Language;
  t: Translations;
}

const WEEK_DAYS: { id: DayOfWeek; name: string }[] = [
  { id: 'monday', name: 'Monday' },
  { id: 'tuesday', name: 'Tuesday' },
  { id: 'wednesday', name: 'Wednesday' },
  { id: 'thursday', name: 'Thursday' },
  { id: 'friday', name: 'Friday' },
  { id: 'saturday', name: 'Saturday' },
  { id: 'sunday', name: 'Sunday' },
];

export const TeacherMediaAssignmentPanel: React.FC<TeacherMediaAssignmentPanelProps> = ({
  routinesByDay,
  students,
  selectedStudentEmail,
  selectedStudentUid,
  currentAccount,
  onTeacherSaveVideos,
  currentLanguage = 'en',
}) => {
  const isEn = true; // Teacher/Native Friend view is 100% English
  // Find current active student info
  const selectedStudent = (students || []).find(
    (s) =>
      (selectedStudentUid && (s.uid === selectedStudentUid || s.id === selectedStudentUid)) ||
      (selectedStudentEmail && (s.email?.toLowerCase() === selectedStudentEmail.toLowerCase() || s.uid === selectedStudentEmail || s.id === selectedStudentEmail))
  );

  const activeStudentEmail = selectedStudent?.email || (selectedStudentEmail && selectedStudentEmail !== 'all' && selectedStudentEmail.includes('@') ? selectedStudentEmail : '') || '';
  const activeStudentUid = selectedStudent?.uid || selectedStudent?.id || (selectedStudentUid && selectedStudentUid !== 'all' ? selectedStudentUid : '');
  const activeStudentName = selectedStudent?.name || (activeStudentEmail ? activeStudentEmail.split('@')[0] : 'Student');

  // Local state for student-specific routines loaded from backend
  const [studentRoutines, setStudentRoutines] = useState<Record<DayOfWeek, RoutineItem[]> | null>(null);
  const [isLoadingStudentRoutines, setIsLoadingStudentRoutines] = useState<boolean>(false);

  // Local state for each day's YouTube URL & Activity
  const [youtubeUrls, setYoutubeUrls] = useState<Record<DayOfWeek, string>>({
    monday: '',
    tuesday: '',
    wednesday: '',
    thursday: '',
    friday: '',
    saturday: '',
    sunday: '',
  });

  // Local state for each day's Spotify URL & Type
  const [spotifyUrls, setSpotifyUrls] = useState<Record<DayOfWeek, string>>({
    monday: '',
    tuesday: '',
    wednesday: '',
    thursday: '',
    friday: '',
    saturday: '',
    sunday: '',
  });

  // Immediately clear state when active student changes to prevent any cross-contamination
  React.useEffect(() => {
    setStudentWatched([]);
    setStudentAssignments([]);
    setStudentRoutines(null);
    setDayPlaylistIds({});
    setYoutubeUrls({
      monday: '',
      tuesday: '',
      wednesday: '',
      thursday: '',
      friday: '',
      saturday: '',
      sunday: '',
    });
    setSpotifyUrls({
      monday: '',
      tuesday: '',
      wednesday: '',
      thursday: '',
      friday: '',
      saturday: '',
      sunday: '',
    });
  }, [activeStudentUid, activeStudentEmail]);

  const [spotifyTypes, setSpotifyTypes] = useState<Record<DayOfWeek, 'podcast' | 'music'>>({
    monday: 'podcast',
    tuesday: 'podcast',
    wednesday: 'podcast',
    thursday: 'podcast',
    friday: 'music',
    saturday: 'podcast',
    sunday: 'music',
  });

  // Spotify player preview and fallback states
  const [selectedPreviewDay, setSelectedPreviewDay] = useState<DayOfWeek>('monday');
  const [isMiniPlayerOpen, setIsMiniPlayerOpen] = useState<boolean>(true);
  const [isResettingAll, setIsResettingAll] = useState<boolean>(false);
  const [playerFallbackMode, setPlayerFallbackMode] = useState<Record<DayOfWeek, boolean>>({
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
  });
  const [spotValidationErrors, setSpotValidationErrors] = useState<Record<DayOfWeek, string>>({
    monday: '',
    tuesday: '',
    wednesday: '',
    thursday: '',
    friday: '',
    saturday: '',
    sunday: '',
  });

  // Save feedback state per day
  const [savedDayFeedback, setSavedDayFeedback] = useState<Record<string, boolean>>({});
  const [savingYtDay, setSavingYtDay] = useState<DayOfWeek | null>(null);
  const [savingSpotDay, setSavingSpotDay] = useState<DayOfWeek | null>(null);
  const [studentProfile, setStudentProfile] = useState<any>(null);

  // YouTube Playlist & Anti-Repetition Video Assignment State
  const [playlists, setPlaylists] = useState<any[]>(DEFAULT_CURATED_PLAYLISTS);

  // Alphabetically sorted playlists for topic selector (preserving Your Suggestion as the first item)
  const sortedPlaylists = React.useMemo(() => {
    return [...playlists].sort((a, b) =>
      (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
    );
  }, [playlists]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>(
    DEFAULT_CURATED_PLAYLISTS[0]?.id || 'PLUj52KVM_CdY'
  );
  const [dayPlaylistIds, setDayPlaylistIds] = useState<Partial<Record<DayOfWeek, string>>>({});
  const [studentAssignments, setStudentAssignments] = useState<any[]>([]);
  const [studentWatched, setStudentWatched] = useState<string[]>([]);
  const [assignLoadingDay, setAssignLoadingDay] = useState<string | null>(null);
  const [assignFeedback, setAssignFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  // Spotify Sequential Anti-Repetition Assignment State
  const [studentSpotifyAssignments, setStudentSpotifyAssignments] = useState<any[]>([]);
  const [studentListenedTracks, setStudentListenedTracks] = useState<string[]>([]);
  const [assigningSpotifyDay, setAssigningSpotifyDay] = useState<DayOfWeek | null>(null);
  const [isDistributingYtWeek, setIsDistributingYtWeek] = useState<boolean>(false);
  const [isDistributingSpotWeek, setIsDistributingSpotWeek] = useState<boolean>(false);

  // Resolved student level for automatic Spotify synchronization
  const currentLevelRaw =
    studentProfile?.level ||
    studentProfile?.studentLevel ||
    selectedStudent?.level ||
    selectedStudent?.studentLevel ||
    'iniciante';
  const currentNormalizedLevel = normalizeStudentLevel(currentLevelRaw);
  const currentLevelConfig = getSpotifyPlaylistForLevel(currentNormalizedLevel);

  // Fetch all playlists dynamically from server or YouTube
  const [isSyncingPlaylists, setIsSyncingPlaylists] = useState(false);
  const loadPlaylists = React.useCallback(async (force = false) => {
    if (force) setIsSyncingPlaylists(true);
    try {
      const res = await fetchDynamicYouTubePlaylists({ force });
      if (res.playlists && res.playlists.length > 0) {
        setPlaylists(res.playlists);
        if (!selectedPlaylistId) {
          setSelectedPlaylistId(res.playlists[0].id);
        }
      }
    } catch (e) {
      console.warn('TeacherMediaAssignmentPanel fetch playlists error:', e);
    } finally {
      setIsSyncingPlaylists(false);
    }
  }, [selectedPlaylistId]);

  React.useEffect(() => {
    loadPlaylists(false);
  }, [loadPlaylists]);

  // Fetch student routines & assignment history strictly synchronized with student page
  const loadStudentMediaData = React.useCallback(async () => {
    setIsLoadingStudentRoutines(true);

    try {
      let routinesData = null;
      let assignmentsList: any[] = [];
      let watchedList: any[] = [];
      let spotifyAssignList: any[] = [];
      let profileData: any = null;

      if (activeStudentEmail || activeStudentUid) {
        const token = await getAccessToken();

        const params = new URLSearchParams();
        if (activeStudentEmail) params.append('studentEmail', activeStudentEmail);
        if (activeStudentUid) params.append('uid', activeStudentUid);

        const profileParams = new URLSearchParams();
        if (activeStudentEmail) profileParams.append('email', activeStudentEmail);
        if (activeStudentUid) profileParams.append('uid', activeStudentUid);

        const [routinesRes, assignmentsRes, spotAssignRes, profileRes] = await Promise.all([
          fetch(`/api/student-routines?${params.toString()}`).catch(() => null),
          fetch(`/api/student-video-assignments?${params.toString()}`).catch(() => null),
          fetch(`/api/student-spotify-assignments?${params.toString()}`).catch(() => null),
          fetch(`/api/user-profile?${profileParams.toString()}`).catch(() => null),
        ]);

        if (routinesRes && routinesRes.ok) {
          routinesData = await routinesRes.json();
        }
        if (assignmentsRes && assignmentsRes.ok) {
          const assignmentsData = await assignmentsRes.json();
          assignmentsList = assignmentsData?.assignments || [];
          watchedList = assignmentsData?.watched || [];
        }
        if (spotAssignRes && spotAssignRes.ok) {
          const spotData = await spotAssignRes.json();
          spotifyAssignList = spotData?.assignments || [];
        }
        if (profileRes && profileRes.ok) {
          const profData = await profileRes.json();
          profileData = profData?.profile || profData?.user || null;
        }

        // Active week resolution strictly anchored to selected student's week, never the teacher's
        let studentCycle = parseWeekCycleNumber(selectedStudent?.weeklyCycle);
        if (studentCycle === null && profileData?.weeklyCycle) {
          studentCycle = parseWeekCycleNumber(profileData.weeklyCycle);
        }
        const resolvedWeekId = studentCycle !== null ? normalizeWeekId(studentCycle) : 'current_week';

        // Protected weekly-checks fetch with valid Bearer token and canonical student identity
        if (token && (activeStudentEmail || (activeStudentUid && isValidCanonicalUid(activeStudentUid)))) {
          try {
            const checksParams = new URLSearchParams();
            if (activeStudentEmail) checksParams.append('studentEmail', activeStudentEmail);
            if (activeStudentUid && isValidCanonicalUid(activeStudentUid)) {
              checksParams.append('studentUid', activeStudentUid);
            }
            if (resolvedWeekId) checksParams.append('weekId', resolvedWeekId);
            if (studentCycle !== null) checksParams.append('weeklyCycle', String(studentCycle));

            const weeklyChecksRes = await fetch(`/api/routines/weekly-checks?${checksParams.toString()}`, {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });
            if (weeklyChecksRes && weeklyChecksRes.ok) {
              const checksData = await weeklyChecksRes.json();
              if (checksData?.weeklyStudyDays && Array.isArray(checksData.weeklyStudyDays) && checksData.weeklyStudyDays.length > 0) {
                profileData = {
                  ...(profileData || {}),
                  weeklyStudyDays: checksData.weeklyStudyDays,
                  weeklyStudyDaysTarget: checksData.weeklyStudyDaysTarget || checksData.weeklyStudyDays.length,
                };
              }
            }
          } catch (err) {
            console.warn('Teacher weekly-checks fetch notice:', err);
          }
        }

        if (selectedStudent?.weeklyStudyDays && (!profileData?.weeklyStudyDays || profileData.weeklyStudyDays.length === 0)) {
          profileData = {
            ...(profileData || {}),
            weeklyStudyDays: selectedStudent.weeklyStudyDays,
            weeklyStudyDaysTarget: selectedStudent.weeklyStudyDaysTarget || selectedStudent.weeklyStudyDays.length,
          };
        }
      }

      if (activeStudentUid) {
        try {
          const firestoreWatched = await fetchWatchedVideosHistoryFromFirestore(activeStudentUid);
          if (firestoreWatched && firestoreWatched.length > 0) {
            watchedList = Array.from(new Set([...watchedList, ...firestoreWatched]));
          }
        } catch (e) {
          console.warn('Notice loading Firestore watched videos for student:', e);
        }
      }

      setStudentProfile(profileData);
      setStudentAssignments(assignmentsList);
      setStudentWatched(watchedList);
      setStudentSpotifyAssignments(spotifyAssignList);

      const resolvedLevelRaw =
        profileData?.level ||
        profileData?.studentLevel ||
        selectedStudent?.level ||
        selectedStudent?.studentLevel ||
        'iniciante';
      const resolvedNormalizedLevel = normalizeStudentLevel(resolvedLevelRaw);

      const activeRoutines: Record<DayOfWeek, RoutineItem[]> =
        routinesData && typeof routinesData === 'object' && Object.keys(routinesData).length > 0
          ? routinesData
          : routinesByDay || defaultRoutinesByDay;

      setStudentRoutines(activeRoutines);

      const newYt: Record<DayOfWeek, string> = {
        monday: '',
        tuesday: '',
        wednesday: '',
        thursday: '',
        friday: '',
        saturday: '',
        sunday: '',
      };
      const newSpot: Record<DayOfWeek, string> = {
        monday: '',
        tuesday: '',
        wednesday: '',
        thursday: '',
        friday: '',
        saturday: '',
        sunday: '',
      };
      const newSpotTypes: Record<DayOfWeek, 'podcast' | 'music'> = {
        monday: 'podcast',
        tuesday: 'podcast',
        wednesday: 'podcast',
        thursday: 'podcast',
        friday: 'music',
        saturday: 'podcast',
        sunday: 'music',
      };
      const newDayPlaylistIds: Partial<Record<DayOfWeek, string>> = {};

      WEEK_DAYS.forEach((d) => {
        // 1. Check latest assignment for this day from student-video-assignments
        const dayAssignments = (assignmentsList || []).filter((a: any) => a && (a.day === d.id || a.dayOfWeek === d.id));
        const latestAssign = dayAssignments.length > 0 ? dayAssignments[dayAssignments.length - 1] : null;

        // 2. Check routine item with video for this day
        const dayItems = (activeRoutines && activeRoutines[d.id]) || (routinesByDay && routinesByDay[d.id]) || (defaultRoutinesByDay && defaultRoutinesByDay[d.id]) || [];
        const itemWithVid =
          dayItems.find((i) => i && i.teacherVideos && i.teacherVideos.length > 0) ||
          dayItems.find(
            (i) =>
              i &&
              (i.id.endsWith('1') ||
                i.activityName?.toLowerCase().includes('vídeo') ||
                i.activityName?.toLowerCase().includes('video') ||
                playlists.some((pl) => pl.title?.toLowerCase().trim() === i.activityName?.toLowerCase().trim()))
          ) ||
          dayItems[0];

        const assignedVid = itemWithVid?.teacherVideos?.[0];
        const assignedVidUrl = assignedVid?.url || (assignedVid?.videoId ? `https://www.youtube.com/watch?v=${assignedVid.videoId}` : '');

        // 3. Accurately resolve the active video assigned to this student's page
        let candidateUrl = '';
        if (latestAssign?.videoUrl && assignedVidUrl) {
          const assignTime = latestAssign.assignedAt ? new Date(latestAssign.assignedAt).getTime() : 0;
          const vidTime = assignedVid?.addedAt ? new Date(assignedVid.addedAt).getTime() : 0;
          candidateUrl = assignTime >= vidTime ? latestAssign.videoUrl : assignedVidUrl;
        } else if (latestAssign?.videoUrl) {
          candidateUrl = latestAssign.videoUrl;
        } else if (assignedVidUrl) {
          candidateUrl = assignedVidUrl;
        } else {
          const defaultDailyVideo = getDailyYouTubeVideoForStudent(resolvedNormalizedLevel, d.id);
          candidateUrl = defaultDailyVideo.url || 'https://www.youtube.com/watch?v=OT1YRzt1f8A';
        }

        // Canonicalize URL to ensure standard https://www.youtube.com/watch?v=... format
        const vidId = extractYouTubeVideoId(candidateUrl);
        newYt[d.id] = vidId ? `https://www.youtube.com/watch?v=${vidId}` : candidateUrl;

        // Sync playlist ID for this day
        if (latestAssign?.playlistId) {
          newDayPlaylistIds[d.id] = latestAssign.playlistId;
        } else if ((assignedVid as any)?.playlistId) {
          newDayPlaylistIds[d.id] = (assignedVid as any).playlistId;
        } else if (itemWithVid?.activityName) {
          const pl = playlists.find(
            (p) =>
              p.title?.toLowerCase().trim() === itemWithVid.activityName?.toLowerCase().trim() ||
              p.id === itemWithVid.activityName
          );
          if (pl) newDayPlaylistIds[d.id] = pl.id;
        }

        // 4. Spotify sync: mirror student's level-based automated track or custom teacher assignment
        const defaultDailyTrack = getDailySpotifyTrackForStudent(resolvedNormalizedLevel, d.id);
        const daySpotifyAssign = (spotifyAssignList || []).find(
          (a: any) => a && (a.day === d.id || a.dayOfWeek === d.id)
        );
        const itemWithSpot = dayItems.find((i) => i && i.teacherSpotify && i.teacherSpotify.url);

        const toAudioType = (type?: string, url?: string): 'podcast' | 'music' => {
          if (type === 'podcast' || type === 'music') return type;
          if (url && (url.includes('/episode/') || url.includes('/show/'))) return 'podcast';
          return 'music';
        };

        let activeSpotUrl = '';
        let activeSpotType: 'podcast' | 'music' = 'music';

        if (daySpotifyAssign && daySpotifyAssign.url) {
          activeSpotUrl = daySpotifyAssign.url;
          activeSpotType = toAudioType(daySpotifyAssign.type, daySpotifyAssign.url);
        } else if (itemWithSpot?.teacherSpotify?.url) {
          activeSpotUrl = itemWithSpot.teacherSpotify.url;
          activeSpotType = toAudioType(itemWithSpot.teacherSpotify.type, itemWithSpot.teacherSpotify.url);
        } else {
          // Strictly synchronize with what student sees by default for their level
          activeSpotUrl = defaultDailyTrack.url;
          activeSpotType = 'music';
        }

        // Auto-sanitize on load: if broken or corrupted link, fallback cleanly to level default
        const parsedSpot = parseSpotifyUrl(activeSpotUrl);
        if (!parsedSpot.isValid) {
          activeSpotUrl = defaultDailyTrack.url;
          activeSpotType = 'music';
        } else if (parsedSpot.canonicalUrl) {
          activeSpotUrl = parsedSpot.canonicalUrl;
        }

        newSpot[d.id] = activeSpotUrl;
        newSpotTypes[d.id] = activeSpotType;
      });

      setYoutubeUrls(newYt);
      setSpotifyUrls(newSpot);
      setSpotifyTypes(newSpotTypes);
      setDayPlaylistIds((prev) => ({ ...newDayPlaylistIds, ...prev }));
    } catch (err) {
      console.warn('Error loading student media data:', err);
    } finally {
      setIsLoadingStudentRoutines(false);
    }
  }, [activeStudentEmail, activeStudentUid, selectedStudent, routinesByDay, playlists]);

  React.useEffect(() => {
    loadStudentMediaData();
  }, [loadStudentMediaData]);

  // Dynamically resolve active study days configured by student
  const activeStudyDays: DayOfWeek[] = React.useMemo(() => {
    const rawDays =
      (studentProfile?.weeklyStudyDays && Array.isArray(studentProfile.weeklyStudyDays) && studentProfile.weeklyStudyDays.length > 0)
        ? studentProfile.weeklyStudyDays
        : (studentProfile?.selectedStudyDays && Array.isArray(studentProfile.selectedStudyDays) && studentProfile.selectedStudyDays.length > 0)
        ? studentProfile.selectedStudyDays
        : (selectedStudent?.weeklyStudyDays && Array.isArray(selectedStudent.weeklyStudyDays) && selectedStudent.weeklyStudyDays.length > 0)
        ? selectedStudent.weeklyStudyDays
        : null;

    if (rawDays && rawDays.length > 0) {
      const validSet = new Set(rawDays.map((d: string) => String(d).toLowerCase().trim()));
      const filtered = WEEK_DAYS.filter((d) => validSet.has(d.id)).map((d) => d.id);
      if (filtered.length > 0) return filtered;
    }

    return WEEK_DAYS.map((d) => d.id);
  }, [studentProfile, selectedStudent]);

  const activeWeekDays = React.useMemo(() => {
    return WEEK_DAYS.filter((d) => activeStudyDays.includes(d.id));
  }, [activeStudyDays]);

  // Retrieve previous active day according to student study calendar
  const getPreviousActiveDay = React.useCallback(
    (currentDayId: DayOfWeek): DayOfWeek => {
      const activeDaysInOrder = WEEK_DAYS.filter((d) => activeStudyDays.includes(d.id)).map((d) => d.id);
      const effectiveActiveDays = activeDaysInOrder.length > 0 ? activeDaysInOrder : WEEK_DAYS.map((d) => d.id);
      const currentActiveIdx = effectiveActiveDays.indexOf(currentDayId);

      if (currentActiveIdx > 0) {
        return effectiveActiveDays[currentActiveIdx - 1];
      } else if (currentActiveIdx === 0 && effectiveActiveDays.length > 1) {
        return effectiveActiveDays[effectiveActiveDays.length - 1];
      } else {
        const calOrder = WEEK_DAYS.map((d) => d.id);
        const currentCalIdx = calOrder.indexOf(currentDayId);
        const preceding = effectiveActiveDays.filter((d) => calOrder.indexOf(d) < currentCalIdx);
        return preceding.length > 0 ? preceding[preceding.length - 1] : (effectiveActiveDays[effectiveActiveDays.length - 1] || 'monday');
      }
    },
    [activeStudyDays]
  );

  // Keep selected preview day aligned with active study days
  React.useEffect(() => {
    if (activeStudyDays.length > 0 && !activeStudyDays.includes(selectedPreviewDay)) {
      setSelectedPreviewDay(activeStudyDays[0]);
    }
  }, [activeStudyDays, selectedPreviewDay]);

  // Helper: Retrieve active playlist topic ID for a specific day
  const getDayPlaylistId = (dayId: DayOfWeek): string => {
    if (dayPlaylistIds[dayId]) return dayPlaylistIds[dayId]!;

    const dayItems = (studentRoutines && studentRoutines[dayId]) || (routinesByDay && routinesByDay[dayId]) || [];
    const itemWithVid =
      dayItems.find((i) => i && i.teacherVideos && i.teacherVideos.length > 0) ||
      dayItems.find(
        (i) =>
          i &&
          (i.id.endsWith('1') ||
            i.activityName?.toLowerCase().includes('vídeo') ||
            i.activityName?.toLowerCase().includes('video') ||
            playlists.some((pl) => pl.title?.toLowerCase().trim() === i.activityName?.toLowerCase().trim()))
      ) ||
      dayItems[0];

    const assignedVid = itemWithVid?.teacherVideos?.[0];
    if ((assignedVid as any)?.playlistId) return (assignedVid as any).playlistId;

    if (
      (assignedVid as any)?.isCustomSuggestion ||
      (assignedVid as any)?.playlistTitle === 'Your Suggestion' ||
      (assignedVid as any)?.playlistTitle === 'Sua Sugestão' ||
      itemWithVid?.activityName === 'Your Suggestion' ||
      itemWithVid?.activityName === 'Sua Sugestão'
    ) {
      return 'custom_suggestion';
    }

    if (
      (assignedVid as any)?.playlistId === 'repeat_previous_video' ||
      (assignedVid as any)?.playlistTitle === 'Repeat Previous Video' ||
      (assignedVid as any)?.playlistTitle === 'Repetir Vídeo Anterior' ||
      itemWithVid?.activityName === 'Repeat Previous Video' ||
      itemWithVid?.activityName === 'Repetir Vídeo Anterior'
    ) {
      return 'repeat_previous_video';
    }

    const dayAssigns = (studentAssignments || []).filter((a: any) => a && (a.day === dayId || a.dayOfWeek === dayId));
    const latestAssign = dayAssigns.length > 0 ? dayAssigns[dayAssigns.length - 1] : null;
    if (
      latestAssign?.playlistId === 'repeat_previous_video' ||
      latestAssign?.playlistTitle?.toLowerCase().includes('repeat') ||
      latestAssign?.playlistTitle?.toLowerCase().includes('repetir')
    ) {
      return 'repeat_previous_video';
    }
    if (
      latestAssign?.playlistId === 'custom_suggestion' ||
      latestAssign?.isCustomSuggestion ||
      latestAssign?.playlistTitle === 'Your Suggestion' ||
      latestAssign?.playlistTitle === 'Sua Sugestão'
    ) {
      return 'custom_suggestion';
    }

    if ((assignedVid as any)?.playlistTitle && playlists.length > 0) {
      const pl = playlists.find(
        (p) => p.title?.toLowerCase().trim() === (assignedVid as any).playlistTitle?.toLowerCase().trim()
      );
      if (pl) return pl.id;
    }

    if (itemWithVid?.activityName && playlists.length > 0) {
      const pl = playlists.find(
        (p) =>
          p.title?.toLowerCase().trim() === itemWithVid.activityName?.toLowerCase().trim() ||
          p.id === itemWithVid.activityName
      );
      if (pl) return pl.id;
    }

    const vidId = extractYouTubeVideoId(assignedVid?.videoId || assignedVid?.url || youtubeUrls[dayId] || '');
    if (vidId && playlists.length > 0) {
      const pl = playlists.find((p) =>
        p.videos?.some((v: any) => extractYouTubeVideoId(v.videoId || v.url || v.id || '') === vidId)
      );
      if (pl) return pl.id;
    }

    if (itemWithVid?.activityName && playlists.length > 0) {
      const pl = playlists.find((p) => itemWithVid.activityName.toLowerCase().includes(p.title.toLowerCase()));
      if (pl) return pl.id;
    }

    return selectedPlaylistId || playlists[0]?.id || '';
  };

  // Handler: Change playlist topic for a specific day from teacher view
  const handleDayPlaylistChange = (dayId: DayOfWeek, newPlId: string) => {
    setDayPlaylistIds((prev) => ({ ...prev, [dayId]: newPlId }));

    if (newPlId === 'custom_suggestion') {
      const topicTitle = isEn ? 'Your Suggestion' : 'Sua Sugestão';
      const dayItems = (studentRoutines && studentRoutines[dayId]) || (routinesByDay && routinesByDay[dayId]) || [];
      const targetActivity =
        dayItems.find((i) => i && i.teacherVideos && i.teacherVideos.length > 0) ||
        dayItems.find(
          (i) =>
            i &&
            (i.id.endsWith('1') ||
              i.activityName?.toLowerCase().includes('vídeo') ||
              i.activityName?.toLowerCase().includes('video') ||
              playlists.some((p) => p.title?.toLowerCase().trim() === i.activityName?.toLowerCase().trim()))
        ) ||
        dayItems[0];

      if (targetActivity) {
        setStudentRoutines((prev) => {
          if (!prev) return prev;
          const updated = { ...prev };
          if (updated[dayId]) {
            updated[dayId] = updated[dayId].map((item) =>
              item.id === targetActivity.id ? { ...item, activityName: topicTitle } : item
            );
          }
          return updated;
        });

        if (activeStudentEmail || activeStudentUid) {
          fetch('/api/routines/teacher-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              studentEmail: activeStudentEmail,
              studentUid: activeStudentUid,
              teacherUid: currentAccount?.uid,
              teacherEmail: currentAccount?.email,
              activityId: targetActivity.id,
              activityName: topicTitle,
              playlistTitle: topicTitle,
              playlistId: 'custom_suggestion',
              videos: targetActivity.teacherVideos || [],
              days: [dayId],
              day: dayId,
            }),
          }).catch(() => {});
        }
      }
      return;
    }

    if (newPlId === 'repeat_previous_video') {
      const prevActiveDay = getPreviousActiveDay(dayId);
      const prevUrl = youtubeUrls[prevActiveDay] || '';
      const prevVidId = extractYouTubeVideoId(prevUrl);
      const topicTitle = isEn ? 'Repeat Previous Video' : 'Repetir Vídeo Anterior';
      const prevDayLabel = WEEK_DAYS.find((w) => w.id === prevActiveDay)?.name || prevActiveDay;

      if (prevUrl) {
        setYoutubeUrls((prev) => ({ ...prev, [dayId]: prevUrl }));
      }

      const dayItems = (studentRoutines && studentRoutines[dayId]) || (routinesByDay && routinesByDay[dayId]) || [];
      const targetActivity =
        dayItems.find((i) => i && i.teacherVideos && i.teacherVideos.length > 0) ||
        dayItems.find(
          (i) =>
            i &&
            (i.id.endsWith('1') ||
              i.activityName?.toLowerCase().includes('vídeo') ||
              i.activityName?.toLowerCase().includes('video') ||
              playlists.some((p) => p.title?.toLowerCase().trim() === i.activityName?.toLowerCase().trim()))
        ) ||
        dayItems[0];

      if (targetActivity) {
        const repeatedVideo: TeacherAssignedVideo = {
          id: `vid-${dayId}-repeat-${Date.now()}`,
          url: prevUrl || 'https://www.youtube.com/watch?v=V1bFr2KGq1g',
          videoId: prevVidId || 'V1bFr2KGq1g',
          title: `Repeated Video (${prevDayLabel})`,
          duration: '5-10 min',
          instructions: `Repeated from ${prevDayLabel}`,
          addedAt: new Date().toISOString(),
          playlistId: 'repeat_previous_video',
          playlistTitle: topicTitle,
        } as any;

        setStudentRoutines((prev) => {
          if (!prev) return prev;
          const updated = { ...prev };
          if (updated[dayId]) {
            updated[dayId] = updated[dayId].map((item) =>
              item.id === targetActivity.id
                ? {
                    ...item,
                    activityName: topicTitle,
                    teacherVideos: [repeatedVideo],
                    teacherNotes: `Repeated from ${prevDayLabel}`,
                  }
                : item
            );
          }
          return updated;
        });

        if (activeStudentEmail || activeStudentUid) {
          fetch('/api/student-video-assignments/assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              studentEmail: activeStudentEmail,
              studentUid: activeStudentUid,
              teacherUid: currentAccount?.uid,
              teacherEmail: currentAccount?.email,
              playlistId: 'repeat_previous_video',
              activityId: targetActivity.id,
              day: dayId,
              videoUrl: prevUrl,
            }),
          }).catch(() => {});
        }

        if (onTeacherSaveVideos) {
          onTeacherSaveVideos(
            targetActivity.id,
            [repeatedVideo],
            `Repeated from ${prevDayLabel}`,
            false,
            [dayId],
            undefined,
            activeStudentEmail,
            activeStudentUid,
            topicTitle
          );
        }

        setAssignFeedback({
          type: 'success',
          message: `🔁 ${isEn ? `Previous video from ${prevDayLabel} assigned for ${dayId.toUpperCase()}` : `Vídeo anterior de ${prevDayLabel} atribuído para ${dayId.toUpperCase()}`}`,
        });
      }
      return;
    }

    const pl = playlists.find((p) => p.id === newPlId);
    if (!pl) return;

    const dayItems = (studentRoutines && studentRoutines[dayId]) || (routinesByDay && routinesByDay[dayId]) || [];
    const targetActivity =
      dayItems.find((i) => i && i.teacherVideos && i.teacherVideos.length > 0) ||
      dayItems.find(
        (i) =>
          i &&
          (i.id.endsWith('1') ||
            i.activityName?.toLowerCase().includes('vídeo') ||
            i.activityName?.toLowerCase().includes('video') ||
            playlists.some((p) => p.title?.toLowerCase().trim() === i.activityName?.toLowerCase().trim()))
      ) ||
      dayItems[0];

    if (targetActivity) {
      setStudentRoutines((prev) => {
        if (!prev) return prev;
        const updated = { ...prev };
        if (updated[dayId]) {
          updated[dayId] = updated[dayId].map((item) =>
            item.id === targetActivity.id ? { ...item, activityName: pl.title } : item
          );
        }
        return updated;
      });

      if (activeStudentEmail || activeStudentUid) {
        fetch('/api/routines/teacher-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentEmail: activeStudentEmail,
            studentUid: activeStudentUid,
            teacherUid: currentAccount?.uid,
            teacherEmail: currentAccount?.email,
            activityId: targetActivity.id,
            activityName: pl.title,
            playlistTitle: pl.title,
            playlistId: pl.id,
            videos: targetActivity.teacherVideos || [],
            days: [dayId],
            day: dayId,
          }),
        }).catch(() => {});
      }

      if (onTeacherSaveVideos) {
        onTeacherSaveVideos(
          targetActivity.id,
          targetActivity.teacherVideos || [],
          targetActivity.teacherNotes,
          false,
          [dayId],
          undefined,
          activeStudentEmail,
          activeStudentUid,
          pl.title
        );
      }
    }
  };

  // Handler: Assign strict exclusive unseen video from playlist
  const handleAssignExclusive = async (dayId: DayOfWeek) => {
    if (!activeStudentEmail && !activeStudentUid) {
      setAssignFeedback({ type: 'warning', message: 'Select a student to assign an exclusive video.' });
      return;
    }

    const dayItems = (studentRoutines && studentRoutines[dayId]) || (routinesByDay && routinesByDay[dayId]) || [];
    const targetActivity =
      dayItems.find((i) => i && i.teacherVideos && i.teacherVideos.length > 0) ||
      dayItems.find(
        (i) =>
          i &&
          (i.id.endsWith('1') ||
            i.activityName?.toLowerCase().includes('vídeo') ||
            i.activityName?.toLowerCase().includes('video') ||
            playlists.some((p) => p.title?.toLowerCase().trim() === i.activityName?.toLowerCase().trim()))
      ) ||
      dayItems[0];
    if (!targetActivity) return;

    const playlistIdToUse = getDayPlaylistId(dayId) || selectedPlaylistId;

    setAssignLoadingDay(dayId);
    setAssignFeedback(null);

    try {
      const res = await fetch('/api/student-video-assignments/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentEmail: activeStudentEmail,
          studentUid: activeStudentUid,
          teacherUid: currentAccount?.uid,
          teacherEmail: currentAccount?.email,
          playlistId: playlistIdToUse,
          activityId: targetActivity.id,
          day: dayId,
        }),
      });

      const data = await res.json();
      if (data.allConsumed) {
        setAssignFeedback({
          type: 'warning',
          message: data.message || `All videos from the selected playlist have already been assigned or watched by this student.`,
        });
      } else if (data.success && data.video) {
        setYoutubeUrls((prev) => ({ ...prev, [dayId]: data.video.url }));
        const assignedTopicTitle = data.playlistTitle || data.video.playlistTitle;

        // Optimistically update studentRoutines with unified activityName
        setStudentRoutines((prev) => {
          if (!prev) return prev;
          const updated = { ...prev };
          if (updated[dayId]) {
            updated[dayId] = updated[dayId].map((item) =>
              item.id === targetActivity.id
                ? {
                    ...item,
                    activityName: assignedTopicTitle || item.activityName,
                    teacherVideos: [data.video],
                    teacherNotes: data.video.instructions,
                  }
                : item
            );
          }
          return updated;
        });

        if (onTeacherSaveVideos) {
          onTeacherSaveVideos(
            targetActivity.id,
            [data.video],
            data.video.instructions,
            false,
            [dayId],
            undefined,
            activeStudentEmail,
            activeStudentUid,
            assignedTopicTitle
          );
        }
        setAssignFeedback({
          type: 'success',
          message: `✨ Unseen exclusive video assigned for ${dayId.toUpperCase()} (${assignedTopicTitle}): "${data.video.title}" (${data.remainingUnseen} remaining)`,
        });
        loadStudentMediaData();
      } else {
        setAssignFeedback({
          type: 'error',
          message: data.error || 'Error assigning exclusive video.',
        });
      }
    } catch {
      setAssignFeedback({
        type: 'error',
        message: 'Connection error while assigning exclusive video.',
      });
    } finally {
      setAssignLoadingDay(null);
    }
  };

  // Handler: When teacher alters the URL in the input field
  const handleUrlChange = (dayId: DayOfWeek, value: string) => {
    setYoutubeUrls((prev) => ({ ...prev, [dayId]: value }));

    // Auto-detect if this URL matches any playlist topic
    const detectedId = extractYouTubeVideoId(value);
    if (detectedId) {
      const matchedPl = playlists.find((p) =>
        p.videos?.some((v: any) => extractYouTubeVideoId(v.videoId || v.url || v.id || '') === detectedId)
      );
      if (matchedPl && dayPlaylistIds[dayId] !== matchedPl.id) {
        setDayPlaylistIds((prev) => ({ ...prev, [dayId]: matchedPl.id }));
      }
    }
  };

  // Handler: Save individual YouTube Video for a day
  const handleSaveYouTubeDay = async (dayId: DayOfWeek) => {
    const dayItems = (studentRoutines && studentRoutines[dayId]) || (routinesByDay && routinesByDay[dayId]) || [];
    const targetActivity =
      dayItems.find((i) => i && i.teacherVideos && i.teacherVideos.length > 0) ||
      dayItems.find(
        (i) =>
          i &&
          (i.id.endsWith('1') ||
            i.activityName?.toLowerCase().includes('vídeo') ||
            i.activityName?.toLowerCase().includes('video') ||
            playlists.some((p) => p.title?.toLowerCase().trim() === i.activityName?.toLowerCase().trim()))
      ) ||
      dayItems[0];
    if (!targetActivity) return;

    const playlistIdToUse = getDayPlaylistId(dayId);
    const matchedPlaylist = playlists.find((p) => p.id === playlistIdToUse);
    const topicTitle = matchedPlaylist?.title || targetActivity.activityName;

    const url = (youtubeUrls[dayId] || '').trim();
    let finalVideos: TeacherAssignedVideo[] = [];

    setSavingYtDay(dayId);
    setAssignFeedback(null);

    let canonicalUrl = url;
    if (url) {
      const vidId = extractYouTubeVideoId(url);
      if (vidId) {
        canonicalUrl = `https://www.youtube.com/watch?v=${vidId}`;
      }

      // Check if video is found in any playlist to preserve authentic title
      let matchedVideoTitle = '';
      if (vidId) {
        for (const pl of playlists) {
          const found = pl.videos?.find(
            (v: any) => extractYouTubeVideoId(v.videoId || v.url || v.id || '') === vidId
          );
          if (found) {
            matchedVideoTitle = found.title;
            break;
          }
        }
      }

      finalVideos = [
        {
          id: `vid-${dayId}-${Date.now()}`,
          url: canonicalUrl,
          videoId: vidId || '',
          title: matchedVideoTitle || `${topicTitle} Practice Video`,
          addedAt: new Date().toISOString(),
          playlistId: playlistIdToUse,
          playlistTitle: topicTitle,
        },
      ];
    }

    // Keep input field cleanly formatted with canonical URL
    if (canonicalUrl !== url) {
      setYoutubeUrls((prev) => ({ ...prev, [dayId]: canonicalUrl }));
    }

    try {
      await fetch('/api/routines/teacher-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentEmail: activeStudentEmail,
          studentUid: activeStudentUid,
          teacherUid: currentAccount?.uid,
          teacherEmail: currentAccount?.email,
          activityId: targetActivity.id,
          activityName: topicTitle,
          playlistTitle: topicTitle,
          playlistId: playlistIdToUse,
          videos: finalVideos,
          days: [dayId],
          day: dayId,
        }),
      });

      setSavedDayFeedback((prev) => ({ ...prev, [`yt-${dayId}`]: true }));
      setTimeout(() => {
        setSavedDayFeedback((prev) => ({ ...prev, [`yt-${dayId}`]: false }));
      }, 3000);

      setAssignFeedback({
        type: 'success',
        message: `✓ Video URL for ${dayId.toUpperCase()} saved and synchronized with student page!`,
      });
      setTimeout(() => setAssignFeedback(null), 4000);
    } catch (err) {
      console.warn('Error saving teacher video:', err);
      setAssignFeedback({
        type: 'error',
        message: 'Error saving video to server.',
      });
    } finally {
      setSavingYtDay(null);
    }

    setStudentRoutines((prev) => {
      if (!prev) return prev;
      const updated = { ...prev };
      if (updated[dayId]) {
        updated[dayId] = updated[dayId].map((item) =>
          item.id === targetActivity.id ? { ...item, activityName: topicTitle, teacherVideos: finalVideos } : item
        );
      }
      return updated;
    });

    if (onTeacherSaveVideos) {
      onTeacherSaveVideos(
        targetActivity.id,
        finalVideos,
        undefined,
        false,
        [dayId],
        undefined,
        activeStudentEmail,
        activeStudentUid,
        topicTitle
      );
    }
  };

  // Handler: Reset a day's Spotify track to the student's verified level default
  const handleResetToDefaultTrack = (dayId: DayOfWeek) => {
    const defaultTrack = getDailySpotifyTrackForStudent(currentNormalizedLevel, dayId);
    setSpotifyUrls((prev) => ({ ...prev, [dayId]: defaultTrack.url }));
    setSpotifyTypes((prev) => ({ ...prev, [dayId]: 'music' }));
    setSpotValidationErrors((prev) => ({ ...prev, [dayId]: '' }));
    setPlayerFallbackMode((prev) => ({ ...prev, [dayId]: false }));
    handleSaveSpotifyDay(dayId, defaultTrack.url, 'music');
  };

  // Handler: Reset active study days to verified curriculum tracks with one click
  const handleResetAllDays = async () => {
    setIsResettingAll(true);
    try {
      const updatedUrls: Record<DayOfWeek, string> = { ...spotifyUrls };
      const updatedTypes: Record<DayOfWeek, 'podcast' | 'music'> = { ...spotifyTypes };

      for (const day of activeWeekDays) {
        const defTrack = getDailySpotifyTrackForStudent(currentNormalizedLevel, day.id);
        updatedUrls[day.id] = defTrack.url;
        updatedTypes[day.id] = 'music';
        await handleSaveSpotifyDay(day.id, defTrack.url, 'music');
      }

      setSpotifyUrls(updatedUrls);
      setSpotifyTypes(updatedTypes);
      setSpotValidationErrors({
        monday: '', tuesday: '', wednesday: '', thursday: '', friday: '', saturday: '', sunday: ''
      });
      setAssignFeedback({
        type: 'success',
        message: `All ${activeWeekDays.length} active days restored and synchronized to verified curriculum audio!`,
      });
    } catch (err) {
      console.error('Error resetting all days:', err);
    } finally {
      setIsResettingAll(false);
    }
  };

  // Handler: Save individual Spotify Audio for a day with strict validation and sanitization
  const handleSaveSpotifyDay = async (dayId: DayOfWeek, overrideUrl?: string, overrideType?: 'podcast' | 'music') => {
    const dayItems = (studentRoutines && studentRoutines[dayId]) || (routinesByDay && routinesByDay[dayId]) || [];
    const targetActivity =
      dayItems.find((i) => i && (i.id.endsWith('2') || i.activityName?.toLowerCase().includes('podcast') || i.activityName?.toLowerCase().includes('áudio'))) ||
      dayItems[1] ||
      dayItems[0];
    if (!targetActivity) return;

    const rawUrl = (overrideUrl !== undefined ? overrideUrl : (spotifyUrls[dayId] || '')).trim();
    const type = overrideType || spotifyTypes[dayId] || 'music';
    const defaultTrack = getDailySpotifyTrackForStudent(currentNormalizedLevel, dayId);

    // Strict validation
    if (rawUrl) {
      const validation = parseSpotifyUrl(rawUrl);
      if (!validation.isValid) {
        setSpotValidationErrors((prev) => ({
          ...prev,
          [dayId]: validation.errorMessage || 'Invalid Spotify link. Use /track/, /episode/ or /show/ links.',
        }));
        setAssignFeedback({
          type: 'error',
          message: validation.errorMessage || 'Invalid Spotify URL. Use a valid /track/, /episode/ or /show/ link.',
        });
        return;
      }
    }

    setSpotValidationErrors((prev) => ({ ...prev, [dayId]: '' }));
    setSavingSpotDay(dayId);

    const parsed = parseSpotifyUrl(rawUrl);
    const canonicalUrl = parsed.isValid && parsed.canonicalUrl ? parsed.canonicalUrl : rawUrl;
    const isDefault = canonicalUrl === defaultTrack.url.trim();

    // Ensure input field is populated with the clean canonical URL
    if (canonicalUrl !== spotifyUrls[dayId]) {
      setSpotifyUrls((prev) => ({ ...prev, [dayId]: canonicalUrl }));
    }

    let finalSpotify: TeacherAssignedSpotify | null = null;

    if (canonicalUrl) {
      finalSpotify = {
        id: `spot-${dayId}-${Date.now()}`,
        url: canonicalUrl,
        title: isDefault
          ? defaultTrack.title
          : type === 'podcast'
          ? 'Recommended English Podcast'
          : 'Recommended English Song',
        artistOrHost: isDefault ? defaultTrack.artist : (currentAccount?.name || 'Native Friend'),
        instructions: isDefault
          ? defaultTrack.teacherTipEn
          : 'Listen attentively to practice your listening comprehension.',
        type,
        addedAt: new Date().toISOString(),
      };
    }

    try {
      const res = await fetch('/api/routines/teacher-spotify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentEmail: activeStudentEmail,
          studentUid: activeStudentUid,
          teacherUid: currentAccount?.uid,
          teacherEmail: currentAccount?.email,
          activityId: targetActivity.id,
          spotify: finalSpotify,
          days: [dayId],
          day: dayId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Error saving audio on server.');
      }

      setSavedDayFeedback((prev) => ({ ...prev, [`spot-${dayId}`]: true }));
      setTimeout(() => {
        setSavedDayFeedback((prev) => ({ ...prev, [`spot-${dayId}`]: false }));
      }, 2500);

      setAssignFeedback({
        type: 'success',
        message: `✓ Spotify audio for ${dayId.toUpperCase()} saved and synchronized with student!`,
      });
      setTimeout(() => setAssignFeedback(null), 3500);
    } catch (err: any) {
      console.warn('Error saving teacher spotify:', err);
      setAssignFeedback({
        type: 'error',
        message: err.message || 'Error saving Spotify audio on server.',
      });
    } finally {
      setSavingSpotDay(null);
    }

    setStudentRoutines((prev) => {
      if (!prev) return prev;
      const updated = { ...prev };
      if (updated[dayId]) {
        updated[dayId] = updated[dayId].map((item) =>
          item.id === targetActivity.id ? { ...item, teacherSpotify: finalSpotify || undefined } : item
        );
      }
      return updated;
    });

    if (onTeacherSaveVideos) {
      onTeacherSaveVideos(
        targetActivity.id,
        targetActivity.teacherVideos || [],
        undefined,
        false,
        [dayId],
        finalSpotify,
        activeStudentEmail,
        activeStudentUid
      );
    }
  };

  // Handler: Assign strict exclusive unseen Spotify track from level curriculum
  const handleAssignExclusiveSpotify = async (dayId: DayOfWeek) => {
    if (!activeStudentEmail && !activeStudentUid) {
      setAssignFeedback({ type: 'warning', message: 'Select a student to assign exclusive track.' });
      return;
    }

    setAssigningSpotifyDay(dayId);
    setAssignFeedback(null);

    try {
      const res = await fetch('/api/student-spotify-assignments/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentEmail: activeStudentEmail,
          studentUid: activeStudentUid,
          teacherUid: currentAccount?.uid,
          teacherEmail: currentAccount?.email,
          day: dayId,
        }),
      });

      const data = await res.json();
      if (data.success && data.track) {
        setSpotifyUrls((prev) => ({ ...prev, [dayId]: data.track.url }));
        setSpotifyTypes((prev) => ({ ...prev, [dayId]: data.track.type || 'music' }));
        setAssignFeedback({
          type: 'success',
          message: `✨ Unseen exclusive track assigned for ${dayId.toUpperCase()}: "${data.track.title}" (${data.remainingUnseen ?? 0} remaining)`,
        });
        await loadStudentMediaData();
      } else {
        setAssignFeedback({
          type: 'error',
          message: data.error || 'Error assigning exclusive Spotify track.',
        });
      }
    } catch {
      setAssignFeedback({
        type: 'error',
        message: 'Connection error while assigning exclusive track.',
      });
    } finally {
      setAssigningSpotifyDay(null);
    }
  };

  // Handler: Distribute exclusive sequential YouTube videos for student active study days
  const handleDistributeWeekYouTube = async () => {
    if (!activeStudentEmail && !activeStudentUid) {
      setAssignFeedback({ type: 'warning', message: 'Select a student to distribute weekly videos.' });
      return;
    }
    setIsDistributingYtWeek(true);
    setAssignFeedback(null);
    try {
      const res = await fetch('/api/student-video-assignments/distribute-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentEmail: activeStudentEmail,
          studentUid: activeStudentUid,
          teacherUid: currentAccount?.uid,
          teacherEmail: currentAccount?.email,
          level: currentNormalizedLevel,
          days: activeWeekDays.map((d) => d.id),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAssignFeedback({
          type: 'success',
          message: `✨ Week of ${activeWeekDays.length} exclusive YouTube ${activeWeekDays.length === 1 ? 'video' : 'videos'} assigned successfully!`,
        });
        await loadStudentMediaData();
      } else {
        setAssignFeedback({
          type: 'error',
          message: data.error || 'Error distributing weekly videos.',
        });
      }
    } catch {
      setAssignFeedback({ type: 'error', message: 'Connection error while distributing videos.' });
    } finally {
      setIsDistributingYtWeek(false);
    }
  };

  // Handler: Distribute exclusive sequential Spotify tracks for student active study days
  const handleDistributeWeekSpotify = async () => {
    if (!activeStudentEmail && !activeStudentUid) {
      setAssignFeedback({ type: 'warning', message: 'Select a student to distribute weekly tracks.' });
      return;
    }
    setIsDistributingSpotWeek(true);
    setAssignFeedback(null);
    try {
      const res = await fetch('/api/student-spotify-assignments/distribute-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentEmail: activeStudentEmail,
          studentUid: activeStudentUid,
          teacherUid: currentAccount?.uid,
          teacherEmail: currentAccount?.email,
          level: currentNormalizedLevel,
          days: activeWeekDays.map((d) => d.id),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAssignFeedback({
          type: 'success',
          message: `✨ Week of ${activeWeekDays.length} exclusive Spotify ${activeWeekDays.length === 1 ? 'track' : 'tracks'} distributed successfully!`,
        });
        await loadStudentMediaData();
      } else {
        setAssignFeedback({
          type: 'error',
          message: data.error || 'Error distributing weekly tracks.',
        });
      }
    } catch {
      setAssignFeedback({ type: 'error', message: 'Connection error while distributing tracks.' });
    } finally {
      setIsDistributingSpotWeek(false);
    }
  };

  // Helper to get first routine item display text (always in English for teacher)
  const getActivityLabel = (dayId: DayOfWeek) => {
    const dayItems = (studentRoutines && studentRoutines[dayId]) || (routinesByDay && routinesByDay[dayId]) || [];
    const itemWithVid =
      dayItems.find((i) => i && i.teacherVideos && i.teacherVideos.length > 0) ||
      dayItems.find((i) => i.id.endsWith('1') || i.activityName?.toLowerCase().includes('vídeo') || i.activityName?.toLowerCase().includes('video')) ||
      dayItems[0];
    if (!itemWithVid) return 'Morning routine';
    const englishName = getActivityDisplayName(itemWithVid.activityName, 'en');
    return `${itemWithVid.time || '09:00'} ${englishName}`;
  };

  return (
    <div className="space-y-6">
      {/* Student context banner if selected */}
      {(selectedStudent || activeStudentEmail) && (
        <div className="bg-gradient-to-r from-[#0A0F24] via-slate-900 to-indigo-950 text-white p-4 rounded-2xl border border-indigo-950/60 flex items-center justify-between flex-wrap gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#1C4C96] flex items-center justify-center font-bold text-white border border-[#607EC9] shrink-0 overflow-hidden">
              {selectedStudent?.picture && selectedStudent.picture.trim() !== '' ? (
                <img
                  src={selectedStudent.picture}
                  alt={selectedStudent.name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <User className="w-5 h-5 text-white" />
              )}
            </div>
            <div>
              <div className="text-[10px] font-bold text-[#9AB4FF] uppercase tracking-wider flex items-center gap-2 flex-wrap">
                <span>STUDENT INDIVIDUAL MEDIA ASSIGNMENT</span>
                {activeStudentUid && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#1C4C96] text-white font-mono">
                    UID: {activeStudentUid.slice(0, 10)}...
                  </span>
                )}
                {currentLevelConfig && (
                  <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-800/80 text-emerald-200 font-bold border border-emerald-500/40 flex items-center gap-1">
                    <Music className="w-2.5 h-2.5 text-[#1DB954]" />
                    <span>LEVEL: {currentLevelConfig.levelLabelEn.toUpperCase()}</span>
                  </span>
                )}
                <span className="text-[9px] px-2 py-0.5 rounded bg-indigo-900/90 text-indigo-200 font-bold border border-indigo-400/40 flex items-center gap-1">
                  <Calendar className="w-2.5 h-2.5 text-amber-300" />
                  <span>
                    STUDY PLAN: {activeWeekDays.length} {activeWeekDays.length === 1 ? 'DAY' : 'DAYS'}/WEEK (
                    {activeWeekDays.map((d) => d.name.slice(0, 3)).join(', ')})
                  </span>
                </span>
              </div>
              <div className="text-sm font-black text-white">
                {selectedStudent ? `${selectedStudent.name} (${selectedStudent.email})` : activeStudentEmail}
              </div>
            </div>
          </div>
          <div className="text-xs text-[#9AB4FF] flex items-center gap-2 font-medium">
            {isLoadingStudentRoutines ? (
              <span className="flex items-center gap-1.5 text-amber-300">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Synchronizing with student routine...</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Mirrored with {activeWeekDays.length} active study days</span>
              </span>
            )}
          </div>
        </div>
      )}



      {/* TABLE 1: Assign YouTube Videos (Filtered to student active study days) */}
      <div className="bg-white rounded-2xl border border-[#607EC9]/30 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#062863]/10 text-[#062863] flex items-center justify-center shrink-0">
              <Youtube className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-sm text-[#000035] uppercase tracking-wider">
                  Assign YouTube Videos
                </h3>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#062863]/10 text-[#062863] border border-[#607EC9]/30">
                  {activeWeekDays.length} {activeWeekDays.length === 1 ? 'Active Day' : 'Active Days'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-normal">
                Displaying only the {activeWeekDays.length} active study days configured by student
              </p>
            </div>
          </div>

          {/* Anti-Repetition Playlist Selector */}
          {playlists.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border border-slate-300 shadow-2xs">
                <ListVideo className="w-3.5 h-3.5 text-[#1C4C96]" />
                <span className="text-[11px] font-bold text-slate-700">Playlist:</span>
                <select
                  value={selectedPlaylistId}
                  onChange={(e) => setSelectedPlaylistId(e.target.value)}
                  className="text-xs font-bold text-[#000035] bg-transparent focus:outline-hidden cursor-pointer"
                >
                  {sortedPlaylists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.title} ({pl.videos?.length || 0} videos)
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => loadPlaylists(true)}
                  disabled={isSyncingPlaylists}
                  title="Sincronizar playlists do YouTube (adm.itissimple@gmail.com)"
                  className="p-1 rounded-lg text-slate-500 hover:text-[#1C4C96] hover:bg-slate-100 transition shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingPlaylists ? 'animate-spin text-amber-500' : ''}`} />
                </button>
              </div>

              {/* Real-time anti-repetition counter badge */}
              {(() => {
                const currentPl = playlists.find((p) => p.id === selectedPlaylistId) || playlists[0];
                const consumed = new Set<string>();
                studentWatched.forEach((id) => {
                  const cid = extractYouTubeVideoId(id);
                  if (cid) consumed.add(cid);
                });
                studentAssignments.forEach((assign) => {
                  const cid = extractYouTubeVideoId(assign.videoId || assign.videoUrl);
                  if (cid) consumed.add(cid);
                });

                const totalVids = currentPl?.videos?.length || 0;
                const unseenVids = (currentPl?.videos || []).filter((v: any) => {
                  const vid = extractYouTubeVideoId(v.videoId || v.url || v.id);
                  return vid && !consumed.has(vid);
                }).length;

                return (
                  <span
                    className={`text-[10px] font-bold px-2 py-1 rounded-lg border flex items-center gap-1 ${
                      unseenVids > 0
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : 'bg-amber-50 text-amber-800 border-amber-300'
                    }`}
                  >
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>
                      {unseenVids > 0
                        ? `${unseenVids} of ${totalVids} unseen videos for this student`
                        : `All ${totalVids} videos already assigned or watched`}
                    </span>
                  </span>
                );
              })()}

              <button
                type="button"
                onClick={handleDistributeWeekYouTube}
                disabled={isDistributingYtWeek}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#062863] hover:bg-[#000035] text-white transition flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-2xs border border-[#9AB4FF]/30"
                title={`Distribute exclusive unseen videos for the student's ${activeWeekDays.length} active study days`}
              >
                {isDistributingYtWeek ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Distributing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3 text-[#F4CA54]" />
                    <span>Distribute Week ({activeWeekDays.length} {activeWeekDays.length === 1 ? 'Video' : 'Videos'})</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Dynamic Assignment Feedback Alert */}
        {assignFeedback && (
          <div
            className={`px-4 py-2.5 text-xs font-semibold flex items-center justify-between border-b ${
              assignFeedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                : 'bg-amber-50 text-amber-900 border-amber-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {assignFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>{assignFeedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setAssignFeedback(null)}
              className="text-slate-400 hover:text-slate-600 font-bold ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#000035] text-white uppercase text-[10px] font-black tracking-wider">
                <th className="p-3 w-32 border-b border-[#062863]">Week day</th>
                <th className="p-3 w-80 border-b border-[#062863]">Activity Moment & Playlist Topic</th>
                <th className="p-3 border-b border-[#062863]">Youtube video url</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {activeWeekDays.map((day, idx) => {
                const isSaved = savedDayFeedback[`yt-${day.id}`];
                const currentUrl = youtubeUrls[day.id] || '';
                const isAssigningThisDay = assignLoadingDay === day.id;
                const isSavingThisDay = savingYtDay === day.id;
                const currentVidId = extractYouTubeVideoId(currentUrl);
                const isValidYt = Boolean(currentVidId);
                const currentDayPlId = getDayPlaylistId(day.id);
                const isCustomSuggestion = currentDayPlId === 'custom_suggestion';
                const isRepeatPrevious = currentDayPlId === 'repeat_previous_video';
                const prevActiveDay = getPreviousActiveDay(day.id);
                const prevDayLabel = WEEK_DAYS.find((w) => w.id === prevActiveDay)?.name || prevActiveDay;
                const dayItems = (studentRoutines && studentRoutines[day.id]) || (routinesByDay && routinesByDay[day.id]) || [];
                const targetActivity =
                  dayItems.find((i) => i && i.teacherVideos && i.teacherVideos.length > 0) ||
                  dayItems.find(
                    (i) =>
                      i &&
                      (i.id.endsWith('1') ||
                        i.activityName?.toLowerCase().includes('vídeo') ||
                        i.activityName?.toLowerCase().includes('video') ||
                        playlists.some((p) => p.title?.toLowerCase().trim() === i.activityName?.toLowerCase().trim()))
                  ) ||
                  dayItems[0];

                return (
                  <tr key={day.id} className="hover:bg-slate-50/70 transition">
                    {/* Day column */}
                    <td className="p-3 font-bold text-[#000035] whitespace-nowrap">
                      <div>{day.name}</div>
                      <div className="text-[10px] text-[#1C4C96] font-semibold">
                        Day {idx + 1} of {activeWeekDays.length}
                      </div>
                    </td>

                    {/* Activity Moment & Playlist Topic column */}
                    <td className="p-3 text-slate-700 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#1C4C96] bg-[#9AB4FF]/15 px-2 py-0.5 rounded-lg shrink-0">
                          {targetActivity?.time || '09:00'}
                        </span>
                        <div className="relative inline-flex items-center min-w-0">
                          {(() => {
                            const isKnownPl =
                              currentDayPlId === 'custom_suggestion' ||
                              currentDayPlId === 'repeat_previous_video' ||
                              sortedPlaylists.some((pl) => pl.id === currentDayPlId);
                            const safeDayPlId = isKnownPl ? currentDayPlId : '';
                            return (
                              <select
                                value={safeDayPlId}
                                onChange={(e) => handleDayPlaylistChange(day.id, e.target.value)}
                                aria-label="Playlist Topic"
                                className="text-xs font-bold py-1 pl-2.5 pr-7 bg-slate-50 hover:bg-white text-[#000035] border border-slate-300 hover:border-[#1C4C96] rounded-xl appearance-none cursor-pointer transition focus:outline-hidden max-w-[210px] truncate shadow-2xs"
                                title="YouTube playlist topic unified with student routine"
                              >
                                <option value="" className="text-slate-500">
                                  {isEn ? '🎯 Choose Topic...' : '🎯 Escolher Tópico...'}
                                </option>
                                <option value="custom_suggestion">
                                  💡 {isEn ? 'Your Suggestion (Student)' : 'Sua Sugestão (Aluno)'}
                                </option>
                                {sortedPlaylists.map((pl) => (
                                  <option key={pl.id} value={pl.id}>
                                    {pl.title}
                                  </option>
                                ))}
                                <option value="repeat_previous_video">
                                  🔁 {isEn ? `Repeat Previous (${prevDayLabel.slice(0, 3)})` : `Repetir Anterior (${prevDayLabel.slice(0, 3)})`}
                                </option>
                              </select>
                            );
                          })()}
                          <ChevronDown className="w-3.5 h-3.5 pointer-events-none absolute right-2 text-[#1C4C96]" />
                        </div>
                        {isCustomSuggestion && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
                            💡 {isEn ? 'Suggestion' : 'Sugestão'}
                          </span>
                        )}
                        {isRepeatPrevious && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 shrink-0" title={`Repeats video from ${prevDayLabel}`}>
                            🔁 {prevDayLabel.slice(0, 3)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Youtube Video URL input row with Recognition indicator, External Preview, Trash, Exclusive Video button, and Save button */}
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1 min-w-[220px]">
                          <input
                            type="url"
                            value={currentUrl}
                            onChange={(e) => handleUrlChange(day.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSaveYouTubeDay(day.id);
                              }
                            }}
                            placeholder="https://www.youtube.com/watch?v=..."
                            className={`w-full pl-3 pr-8 py-1.5 text-xs text-[#000035] bg-slate-50 border rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#1C4C96] focus:bg-white transition ${
                              isValidYt
                                ? 'border-emerald-400/80 bg-emerald-50/20'
                                : currentUrl
                                ? 'border-amber-300'
                                : 'border-slate-300'
                            }`}
                            title="Press Enter or click Save to update student video"
                          />
                          {/* Live recognition & external test link icon */}
                          {currentVidId && (
                            <a
                              href={`https://www.youtube.com/watch?v=${currentVidId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition p-0.5 rounded cursor-pointer"
                              title={`Recognized YouTube video (ID: ${currentVidId}) - Click to test`}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>

                        {/* Exclusive Unseen Video Button */}
                        <button
                          type="button"
                          onClick={() => handleAssignExclusive(day.id)}
                          disabled={isAssigningThisDay}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1 shrink-0 bg-amber-400 hover:bg-amber-300 text-[#000035] border border-amber-500/40 disabled:opacity-50 cursor-pointer shadow-2xs"
                          title="Assign an exclusive unseen video from the selected playlist"
                        >
                          {isAssigningThisDay ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5 text-[#000035]" />
                          )}
                          <span className="whitespace-nowrap">Exclusive Video</span>
                        </button>

                        {currentUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              handleUrlChange(day.id, '');
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-700 transition rounded-md hover:bg-slate-100 cursor-pointer shrink-0"
                            title="Clear video URL"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleSaveYouTubeDay(day.id)}
                          disabled={isSavingThisDay}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs ${
                            isSaved
                              ? 'bg-emerald-600 text-white'
                              : isSavingThisDay
                              ? 'bg-[#1C4C96]/70 text-white'
                              : 'bg-[#1C4C96] hover:bg-[#062863] text-white'
                          }`}
                          title="Save and synchronize URL with student page"
                        >
                          {isSavingThisDay ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Saving...</span>
                            </>
                          ) : isSaved ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Saved ✓</span>
                            </>
                          ) : (
                            <>
                              <Save className="w-3.5 h-3.5" />
                              <span>Save</span>
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* TABLE 2: Spotify Audio Assignment - Single Unified Source of Truth */}
      {(activeStudentUid || activeStudentEmail) && (
        <NativeFriendSpotifyTable
          studentUid={activeStudentUid || activeStudentEmail}
          studentEmail={activeStudentEmail}
          studentName={activeStudentName}
          studentLevel={currentNormalizedLevel}
          teacherUid={currentAccount?.uid || currentAccount?.id || currentAccount?.email}
          teacherName={currentAccount?.name || 'Native Friend'}
          teacherEmail={currentAccount?.email}
          weeklyCycle={studentProfile?.weeklyCycle || selectedStudent?.weeklyCycle || 1}
          activeStudyDays={activeStudyDays}
          currentLanguage={currentLanguage}
        />
      )}
    </div>
  );
};
