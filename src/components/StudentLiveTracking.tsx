import React from 'react';
import {
  TeacherSpotifyRoutineTracker,
  TeacherSpotifyRoutineTrackerProps,
} from './TeacherSpotifyRoutineTracker';

/**
 * StudentLiveTracking Component:
 * Real-time tracker for the Native Friend panel monitoring the student's
 * Song of the Day and daily routine progress via Firestore onSnapshot.
 */
export const StudentLiveTracking: React.FC<TeacherSpotifyRoutineTrackerProps> = (props) => {
  return <TeacherSpotifyRoutineTracker {...props} />;
};

export default StudentLiveTracking;
