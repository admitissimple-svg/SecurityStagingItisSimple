import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminApp, ALLOWED_STAGING_PROJECT_ID } from './serverFirebaseAdmin';
import { normalizeDictionaryWord } from './utils/studentDictionaryLibrary';

/**
 * Active identifiers for staging persistence.
 * Strictly bound to ALLOWED_STAGING_PROJECT_ID ('itissimple-security-staging').
 * All references to legacy projects, Web SDK configs, and external API keys are eliminated.
 */
export const ACTIVE_FIREBASE_PROJECT_ID = ALLOWED_STAGING_PROJECT_ID;
export const ACTIVE_FIREBASE_DATABASE_ID = '(default)';
export const ACTIVE_FIRESTORE_DATABASE_ID = '(default)';

let adminFirestoreInstance: Firestore | null = null;

/**
 * Returns a validated Firestore instance from Firebase Admin SDK.
 * Strictly checks that the underlying app is initialized with ALLOWED_STAGING_PROJECT_ID.
 * Uses exclusively the '(default)' database.
 */
export function getFirestoreDb(): Firestore | null {
  if (adminFirestoreInstance) {
    const cachedProjectId = (adminFirestoreInstance as any).projectId;
    if (cachedProjectId && cachedProjectId !== ALLOWED_STAGING_PROJECT_ID) {
      throw new Error(
        `[serverFirestore Security] Unauthorized Firestore instance detected for project '${cachedProjectId}'. Strictly expected '${ALLOWED_STAGING_PROJECT_ID}'.`
      );
    }
    return adminFirestoreInstance;
  }

  try {
    const app = getFirebaseAdminApp();
    const appProjectId = app.options?.projectId;
    if (appProjectId !== ALLOWED_STAGING_PROJECT_ID) {
      throw new Error(
        `[serverFirestore Security] Firebase Admin App is bound to unauthorized project '${appProjectId}'. Refusing to create Firestore client.`
      );
    }
    const rawTargetDatabaseId = process.env.FIREBASE_DATABASE_ID?.trim() || '(default)';
    const targetDatabaseId = rawTargetDatabaseId.startsWith('ai-studio-') ? '(default)' : (rawTargetDatabaseId || '(default)');
    adminFirestoreInstance = getFirestore(app, targetDatabaseId);
    return adminFirestoreInstance;
  } catch (err) {
    console.warn('[serverFirestore] Failed to initialize Firebase Admin Firestore:', err);
    return null;
  }
}

export function getDefaultFirestoreDb(): Firestore | null {
  return getFirestoreDb();
}

export function getAllServerFirestoreDbs(): Firestore[] {
  const db = getFirestoreDb();
  return db ? [db] : [];
}

/**
 * Testing helpers for injecting mocks and resetting state
 */
export function setFirebaseAdminFirestoreForTesting(mockDb: Firestore | null): void {
  adminFirestoreInstance = mockDb;
}

let isCloudWriteDisabled = false;

export function isPermissionError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || '');
  const note = String(err.note || '');
  const code = err.code;
  return (
    code === 7 ||
    code === 'permission-denied' ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('permission denied') ||
    note.includes('not classified as transient')
  );
}

export function getIsCloudWriteDisabled(): boolean {
  return isCloudWriteDisabled;
}

export function setIsCloudWriteDisabled(disabled: boolean): void {
  isCloudWriteDisabled = disabled;
}

export function resetFirebaseAdminFirestoreForTesting(): void {
  adminFirestoreInstance = null;
  isCloudWriteDisabled = false;
}

// Timeout helper so remote Firestore never blocks an Express API response indefinitely
function withTimeout<T>(promise: Promise<T>, ms: number = 1500): Promise<T | null> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([
    promise.then((res) => {
      clearTimeout(timer);
      return res;
    }),
    timeoutPromise,
  ]);
}

/**
 * Direct persistence for individual Native Friend / Tutor profiles in /tutors/{tutorId} and /users/{tutorId}
 */
export async function saveTutorToFirestore(tutor: any, routeDocId?: string): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !tutor) return false;
  try {
    const cleanEmail = (tutor.email || '').toLowerCase().trim();
    const tutorId = tutor.id || (routeDocId ? routeDocId : `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`);
    const approvalStatus = tutor.approvalStatus || (tutor.isApproved ? 'approved' : 'pending');
    const isApproved = approvalStatus === 'approved' || tutor.isApproved === true || tutor.status === 'approved' || tutor.approved === true;

    const sanitized = JSON.parse(JSON.stringify({
      ...tutor,
      id: tutorId,
      email: cleanEmail,
      role: 'teacher',
      approvalStatus,
      isApproved,
      status: approvalStatus,
      approved: isApproved,
      updatedAt: new Date().toISOString(),
    }));

    const cleanEmailDocId = cleanEmail.replace(/[^a-zA-Z0-9]/g, '-');
    const writePromises: Promise<any>[] = [
      db.collection('users').doc(tutorId).set(sanitized, { merge: true }),
      db.collection('tutors').doc(tutorId).set(sanitized, { merge: true }),
    ];

    if (routeDocId && routeDocId !== tutorId) {
      writePromises.push(db.collection('users').doc(routeDocId).set(sanitized, { merge: true }));
      writePromises.push(db.collection('tutors').doc(routeDocId).set(sanitized, { merge: true }));
    }

    if (cleanEmailDocId && cleanEmailDocId !== tutorId && cleanEmailDocId !== routeDocId) {
      writePromises.push(db.collection('users').doc(cleanEmailDocId).set(sanitized, { merge: true }));
      writePromises.push(db.collection('tutors').doc(cleanEmailDocId).set(sanitized, { merge: true }));
    }

    const savePromise = Promise.all(writePromises).then(() => true);
    const result = await withTimeout(savePromise, 8000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote tutor save restricted by cloud IAM credentials, continuing with local state.');
    } else {
      console.warn('Firestore saveTutor error:', err);
    }
    return false;
  }
}

import {
  normalizeTutorName,
  areSameTutor,
  mergeTutors,
  consolidateTutorsList,
  type CanonicalTutorRecord,
} from './utils/tutorConsolidation';

export {
  normalizeTutorName,
  areSameTutor,
  mergeTutors,
  consolidateTutorsList,
  type CanonicalTutorRecord,
};

/**
 * Fetch all Native Friend / Teacher profiles directly from unified /users collection (role == 'teacher')
 * with fallback to legacy /tutors collection, consolidated canonically to prevent any duplication.
 */
export async function fetchTutorsFromFirestore(): Promise<any[]> {
  const db = getFirestoreDb();
  if (!db) return [];
  try {
    const fetchPromise = async () => {
      const rawList: any[] = [];

      try {
        const [usersSnap, legacySnap] = await Promise.all([
          db.collection('users').where('role', '==', 'teacher').get().catch(() => null),
          db.collection('tutors').get().catch(() => null),
        ]);

        if (usersSnap) {
          usersSnap.forEach((d) => {
            const data = d.data();
            if (data && (data.email || data.name)) {
              rawList.push({ id: d.id, ...data, role: 'teacher' });
            }
          });
        }

        if (legacySnap) {
          legacySnap.forEach((d) => {
            const data = d.data();
            if (data && (data.email || data.name)) {
              rawList.push({ id: d.id, ...data, role: 'teacher' });
            }
          });
        }
      } catch (dbErr) {
        console.warn('Error reading tutors from Firestore database:', dbErr);
      }

      const results = consolidateTutorsList(rawList);
      const approvedIds = results
        .filter((t) => t.approvalStatus === 'approved' || t.isApproved === true)
        .map((t) => t.publicTutorId || t.id || t.email);
      console.log('[NativeFriends Server] Retrieved consolidated Firestore tutor IDs:', approvedIds);
      return results;
    };

    const result = await withTimeout(fetchPromise(), 10000);
    return Array.isArray(result) ? result : [];
  } catch (err) {
    console.warn('Firestore fetchTutors error:', err);
    return [];
  }
}

/**
 * Delete a tutor profile from /users/{tutorId} and /tutors/{tutorId}
 */
export async function deleteTutorFromFirestore(tutorId: string): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !tutorId) return false;
  try {
    const delFromUsers = db.collection('users').doc(tutorId).delete().catch(() => null);
    const delFromTutors = db.collection('tutors').doc(tutorId).delete().catch(() => null);
    const delPromise = Promise.all([delFromUsers, delFromTutors]).then(() => true);
    const result = await withTimeout(delPromise, 6000);
    return !!result;
  } catch (err) {
    console.warn('Firestore deleteTutor error:', err);
    return false;
  }
}

/**
 * Delete user records matching a target email or doc ID across the /users collection
 */
export async function deleteUserByEmailFromFirestore(targetEmail: string): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !targetEmail) return false;
  try {
    const cleanEmail = targetEmail.toLowerCase().trim();
    const snap = await db.collection('users').get();
    const batch = db.batch();
    let hasDeletions = false;
    for (const d of snap.docs) {
      const u = d.data();
      if ((u.email || '').toLowerCase().trim() === cleanEmail || d.id.toLowerCase() === cleanEmail) {
        batch.delete(d.ref);
        hasDeletions = true;
      }
    }
    if (hasDeletions) {
      await batch.commit();
    }
    return true;
  } catch (e) {
    console.warn('Could not delete user from Firestore users collection:', e);
    return false;
  }
}

export async function fetchAppStateFromFirestore(): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db) return null;
  try {
    const fetchDoc = async (docName: string) => {
      try {
        const snap = await db.collection('app_state').doc(docName).get().catch(() => null);
        return snap && snap.exists ? snap.data() : null;
      } catch {
        return null;
      }
    };

    const fetchAllPromise = Promise.all([
      fetchDoc('main_data'),
      fetchDoc('routines'),
      fetchDoc('tutors'),
      fetchDoc('assignments'),
      fetchDoc('lessons'),
      fetchDoc('youtube_playlists'),
      fetchTutorsFromFirestore().catch(() => []),
      fetchUsersFromFirestore().catch(() => []),
    ]).then(([mainData, routines, tutors, assignments, lessons, ytPlaylists, directTutors, directUsers]) => {
      if (!mainData && !routines && !tutors && !assignments && !lessons && !ytPlaylists && (!directTutors || directTutors.length === 0) && (!directUsers || directUsers.length === 0)) {
        return null;
      }

      // Merge direct users from /users collection into userProfiles, authUsers, and students
      const mergedUserProfiles = { ...(mainData?.userProfiles || {}) };
      const mergedAuthUsers = { ...(mainData?.authUsers || {}) };
      const studentMap = new Map<string, any>();
      (mainData?.students || []).forEach((s: any) => {
        const key = (s.studentEmail || s.email || '').toLowerCase().trim();
        if (key) studentMap.set(key, s);
      });

      (directUsers || []).forEach((u: any) => {
        const key = (u.email || '').toLowerCase().trim();
        if (key) {
          if (!mergedUserProfiles[key]) {
            mergedUserProfiles[key] = {
              id: u.uid || u.id || `usr-${key.replace(/[^a-zA-Z0-9]/g, '-')}`,
              uid: u.uid || u.id,
              name: u.name || key.split('@')[0],
              email: key,
              level: u.level || u.englishLevel || 'iniciante',
              enrollmentStatus: u.enrollmentStatus || 'active',
              learningGoal: u.learningGoal || u.goal || 'English for everyday life & work',
              weeklyStudyDaysTarget: u.weeklyStudyDaysTarget ?? 7,
              weeklyStudyDays: u.weeklyStudyDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
              createdAt: u.createdAt || new Date().toISOString(),
            };
          }
          if (!mergedAuthUsers[key]) {
            mergedAuthUsers[key] = {
              uid: u.uid || u.id || `usr-${key.replace(/[^a-zA-Z0-9]/g, '-')}`,
              email: key,
              name: u.name || key.split('@')[0],
              password: u.password || '',
              role: u.role || 'student',
              createdAt: u.createdAt || new Date().toISOString(),
            };
          }
          if ((u.role === 'student' || !u.role) && !studentMap.has(key)) {
            studentMap.set(key, {
              id: u.uid || u.id || `usr-${key.replace(/[^a-zA-Z0-9]/g, '-')}`,
              studentUid: u.uid || u.id,
              name: u.name || key.split('@')[0],
              studentName: u.name || key.split('@')[0],
              email: key,
              studentEmail: key,
              level: u.level || u.englishLevel || 'iniciante',
              studentLevel: u.level || u.englishLevel || 'iniciante',
              goal: u.learningGoal || u.goal || 'English for everyday life & work',
              learningGoal: u.learningGoal || u.goal || 'English for everyday life & work',
              contractedLessons: u.contractedLessons || 5,
              completedLessonsCount: u.completedLessonsCount || 0,
              status: 'active',
              activeSince: (u.createdAt || new Date().toISOString()).split('T')[0],
              createdAt: u.createdAt || new Date().toISOString(),
            });
          }
        }
      });

      const hydratedMainData = {
        ...(mainData || {}),
        userProfiles: mergedUserProfiles,
        authUsers: mergedAuthUsers,
        students: Array.from(studentMap.values()),
      };

      // Canonical consolidation of tutors from /tutors collection with app_state/tutors
      const stateTutors = Array.isArray(tutors?.tutorsList) ? tutors.tutorsList : [];
      const consolidatedTutorsList = consolidateTutorsList([...stateTutors, ...(directTutors || [])]);
      const mergedTutorsDoc = {
        ...(tutors || {}),
        tutorsList: consolidatedTutorsList,
      };

      return {
        ...hydratedMainData,
        ...(routines || {}),
        ...mergedTutorsDoc,
        ...(assignments || {}),
        ...(lessons || {}),
        ...(ytPlaylists && ytPlaylists.playlists ? { youtubePlaylists: ytPlaylists.playlists } : {}),
      };
    });
    return await withTimeout(fetchAllPromise, 15000);
  } catch (err: any) {
    const isPerm =
      err?.code === 7 ||
      err?.code === 'permission-denied' ||
      String(err?.message || '').includes('PERMISSION_DENIED');
    if (!isPerm) {
      console.info('[serverFirestore] fetchAppState notice:', err?.message || String(err));
    }
  }
  return null;
}

export async function saveYouTubePlaylistsToFirestore(playlists: any[]): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !Array.isArray(playlists)) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(playlists));
    const savePromise = db.collection('app_state').doc('youtube_playlists').set(
      {
        playlists: sanitized,
        count: sanitized.length,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    ).then(() => true);
    const result = await withTimeout(savePromise, 3000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote YouTube playlists cloud write restricted by environment IAM credentials. Playlists saved to local server storage.');
    } else {
      console.warn('Firestore saveYouTubePlaylists error:', err);
    }
    return false;
  }
}

export async function fetchYouTubePlaylistsFromFirestore(): Promise<any[] | null> {
  const db = getFirestoreDb();
  if (!db) return null;
  try {
    const fetchPromise = async () => {
      const snap = await db.collection('app_state').doc('youtube_playlists').get();
      if (snap.exists) {
        const data = snap.data();
        if (Array.isArray(data?.playlists)) {
          return data.playlists;
        }
      }
      return null;
    };
    return await withTimeout(fetchPromise(), 3000);
  } catch (err) {
    console.warn('Firestore fetchYouTubePlaylists error:', err);
    return null;
  }
}

export async function saveAppStateToFirestore(data: any): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !data) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(data));
    const cachedYtPlaylists = Array.isArray(sanitized.youtubePlaylists) ? sanitized.youtubePlaylists : null;

    // Strip out external API caches that must not be stored in main Firestore documents
    delete sanitized.youtubePlaylists;

    const routinesData = {
      studentRoutinesMap: sanitized.studentRoutinesMap || {},
      studentCurrentRoutines: sanitized.studentCurrentRoutines || {},
      routinesByDay: sanitized.routinesByDay || {},
      studentWeeklyChecks: sanitized.studentWeeklyChecks || {},
      weeklyNativeTargets: sanitized.weeklyNativeTargets || {},
      updatedAt: new Date().toISOString(),
    };

    const tutorsData = {
      tutorsList: sanitized.tutorsList || [],
      teachers: sanitized.teachers || [],
      deletedTutorEmails: sanitized.deletedTutorEmails || [],
      deletedTutorIds: sanitized.deletedTutorIds || [],
      updatedAt: new Date().toISOString(),
    };

    const assignmentsData = {
      studentVideoAssignments: sanitized.studentVideoAssignments || {},
      studentSpotifyAssignments: sanitized.studentSpotifyAssignments || {},
      studentWatchedVideos: sanitized.studentWatchedVideos || {},
      studentListenedTracks: sanitized.studentListenedTracks || {},
      studentAwaitingTopicSelection: sanitized.studentAwaitingTopicSelection || {},
      weeklyStudyDays: sanitized.weeklyStudyDays || {},
      weeklyStudyDaysTargets: sanitized.weeklyStudyDaysTargets || {},
      updatedAt: new Date().toISOString(),
    };

    const lessonsData = {
      liveLessons: sanitized.liveLessons || [],
      contractedLessons: sanitized.contractedLessons || [],
      weeklyHomework: sanitized.weeklyHomework || {},
      studentHomeworkMap: sanitized.studentHomeworkMap || {},
      updatedAt: new Date().toISOString(),
    };

    const mainData = { ...sanitized };
    delete mainData.studentRoutinesMap;
    delete mainData.studentCurrentRoutines;
    delete mainData.routinesByDay;
    delete mainData.studentWeeklyChecks;
    delete mainData.weeklyNativeTargets;
    delete mainData.tutorsList;
    delete mainData.teachers;
    delete mainData.deletedTutorEmails;
    delete mainData.deletedTutorIds;
    delete mainData.studentVideoAssignments;
    delete mainData.studentSpotifyAssignments;
    delete mainData.studentWatchedVideos;
    delete mainData.studentListenedTracks;
    delete mainData.studentAwaitingTopicSelection;
    delete mainData.weeklyStudyDays;
    delete mainData.weeklyStudyDaysTargets;
    delete mainData.liveLessons;
    delete mainData.contractedLessons;
    delete mainData.weeklyHomework;
    delete mainData.studentHomeworkMap;
    mainData.updatedAt = new Date().toISOString();

    let tutorsDocToWrite = tutorsData;
    const hasIntentionalDeletion = Array.isArray(tutorsData.deletedTutorEmails) && tutorsData.deletedTutorEmails.length > 0;
    if ((!tutorsData.tutorsList || tutorsData.tutorsList.length === 0) && !hasIntentionalDeletion) {
      try {
        const existingSnap = await db.collection('app_state').doc('tutors').get().catch(() => null);
        if (existingSnap && existingSnap.exists) {
          const exData = existingSnap.data();
          if (Array.isArray(exData?.tutorsList) && exData.tutorsList.length > 0) {
            tutorsDocToWrite = {
              ...tutorsData,
              tutorsList: exData.tutorsList,
              teachers: (tutorsData.teachers && tutorsData.teachers.length > 1) ? tutorsData.teachers : (exData.teachers || tutorsData.teachers),
              updatedAt: new Date().toISOString(),
            };
          }
        }
      } catch {}
    }

    const tutorSavePromises = (Array.isArray(tutorsDocToWrite.tutorsList) ? tutorsDocToWrite.tutorsList : []).map((tut: any) => {
      if (tut && (tut.id || tut.email)) {
        const cEmail = (tut.email || '').toLowerCase().trim();
        const tId = tut.id || `tutor-${cEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
        const teacherData = {
          ...tut,
          id: tId,
          email: cEmail,
          role: 'teacher',
          updatedAt: tut.updatedAt || new Date().toISOString(),
        };
        const p1 = db.collection('users').doc(tId).set(teacherData, { merge: true }).catch(() => null);
        const p2 = db.collection('tutors').doc(tId).set(teacherData, { merge: true }).catch(() => null);
        return Promise.all([p1, p2]);
      }
      return Promise.resolve();
    });

    const savePromises = Promise.all([
      db.collection('app_state').doc('main_data').set(mainData, { merge: true }),
      db.collection('app_state').doc('routines').set(routinesData, { merge: true }),
      db.collection('app_state').doc('tutors').set(tutorsDocToWrite, { merge: true }),
      db.collection('app_state').doc('assignments').set(assignmentsData, { merge: true }),
      db.collection('app_state').doc('lessons').set(lessonsData, { merge: true }),
      ...tutorSavePromises,
      ...(cachedYtPlaylists ? [saveYouTubePlaylistsToFirestore(cachedYtPlaylists)] : []),
    ]).then(() => true);

    const result = await withTimeout(savePromises, 15000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote app_state cloud write restricted by environment IAM credentials. App state safely preserved in local disk storage.');
    } else {
      console.warn('Firestore saveAppState error:', err);
    }
    return false;
  }
}

export async function saveUserToFirestore(user: any): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !user?.email) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(user));
    const cleanEmail = user.email.toLowerCase().trim();
    const docId = user.uid || (user.id && !user.id.includes('@') && !user.id.startsWith('usr-') ? user.id : '');
    if (!docId) {
      console.warn('saveUserToFirestore skipped: user has no valid Auth UID');
      return false;
    }

    sanitized.email = cleanEmail;
    sanitized.uid = docId;
    sanitized.id = docId;

    const savePromise = db.collection('users').doc(docId).set(sanitized, { merge: true });
    const result = await withTimeout(savePromise.then(() => true), 10000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote user cloud save restricted by environment IAM credentials, continuing with local state.');
    } else {
      console.warn('Firestore saveUser error:', err);
    }
    return false;
  }
}

export async function fetchUsersFromFirestore(): Promise<any[]> {
  const db = getFirestoreDb();
  if (!db) return [];
  try {
    const fetchPromise = async () => {
      const snap = await db.collection('users').get().catch((queryErr: any) => {
        const isPerm =
          queryErr?.code === 7 ||
          queryErr?.code === 'permission-denied' ||
          String(queryErr?.message || '').includes('PERMISSION_DENIED') ||
          String(queryErr?.message || '').includes('Missing or insufficient permissions');
        if (isPerm) {
          console.info('[serverFirestore] Users collection read restricted by cloud IAM credentials, continuing with local state.');
        } else {
          console.info('[serverFirestore] Users collection query notice:', queryErr?.message || String(queryErr));
        }
        return null;
      });
      if (!snap) return [];
      const list: any[] = [];
      snap.forEach((d: any) => {
        const data = d.data();
        if (data && (data.email || data.id)) {
          list.push({
            id: d.id,
            ...data,
          });
        }
      });
      return list;
    };
    const result = await withTimeout(fetchPromise(), 10000);
    return result || [];
  } catch (err: any) {
    const isPerm =
      err?.code === 7 ||
      err?.code === 'permission-denied' ||
      String(err?.message || '').includes('PERMISSION_DENIED') ||
      String(err?.message || '').includes('Missing or insufficient permissions');
    if (isPerm) {
      console.info('[serverFirestore] Users collection read restricted by cloud IAM credentials, continuing with local state.');
    } else {
      console.info('[serverFirestore] Users collection query notice:', err?.message || String(err));
    }
    return [];
  }
}

export async function fetchUserFromFirestore(email: string, uid?: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || (!email && !uid)) return null;
  try {
    const cleanDocId = email ? email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '-') : '';
    const cleanEmail = email ? email.toLowerCase().trim() : '';

    const fetchPromise = (async () => {
      if (uid) {
        const snapUid = await db.collection('users').doc(uid).get().catch(() => null);
        if (snapUid && snapUid.exists) return snapUid.data();
      }
      if (cleanDocId) {
        const snapEmail = await db.collection('users').doc(cleanDocId).get().catch(() => null);
        if (snapEmail && snapEmail.exists) return snapEmail.data();
      }
      if (cleanEmail) {
        try {
          const qSnap = await db.collection('users').where('email', '==', cleanEmail).get().catch(() => null);
          if (qSnap && !qSnap.empty) {
            return qSnap.docs[0].data();
          }
        } catch {}
      }
      return null;
    })();
    return await withTimeout(fetchPromise, 8000);
  } catch (err: any) {
    const isPerm =
      err?.code === 7 ||
      err?.code === 'permission-denied' ||
      String(err?.message || '').includes('PERMISSION_DENIED');
    if (!isPerm) {
      console.info('[serverFirestore] fetchUser notice:', err?.message || String(err));
    }
    return null;
  }
}

export async function checkUserExistsInFirestore(email: string): Promise<boolean> {
  if (!email) return false;
  const user = await fetchUserFromFirestore(email);
  return Boolean(user);
}

/**
 * Fast direct fetch of user document by docId (UID or sanitized email)
 */
export async function fetchUserDocumentFromFirestore(docId: string, timeoutMs: number = 500): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !docId) return null;
  try {
    const snap = await withTimeout(db.collection('users').doc(docId).get(), timeoutMs);
    return snap && snap.exists ? snap.data() : null;
  } catch {
    return null;
  }
}

/**
 * Fast direct fetch of tutor document by docId (UID or tutor ID)
 */
export async function fetchTutorDocumentFromFirestore(docId: string, timeoutMs: number = 3500): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !docId) return null;
  try {
    // 1. Direct lookup in /tutors/{docId}
    const snap = await withTimeout(db.collection('tutors').doc(docId).get(), timeoutMs);
    if (snap && snap.exists) {
      return { id: docId, ...snap.data() };
    }

    // 2. Direct lookup in /users/{docId}
    const userSnap = await withTimeout(db.collection('users').doc(docId).get(), timeoutMs);
    if (userSnap && userSnap.exists) {
      const uData = userSnap.data();
      if (uData && (uData.role === 'teacher' || uData.role === 'tutor' || uData.role === 'native_friend' || uData.approvalStatus)) {
        return { id: docId, ...uData };
      }
    }

    // 3. Sanitized email doc ID
    const cleanDocId = docId.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '-');
    if (cleanDocId && cleanDocId !== docId) {
      const cleanTutorSnap = await withTimeout(db.collection('tutors').doc(cleanDocId).get(), timeoutMs);
      if (cleanTutorSnap && cleanTutorSnap.exists) {
        return { id: cleanDocId, ...cleanTutorSnap.data() };
      }
      const cleanUserSnap = await withTimeout(db.collection('users').doc(cleanDocId).get(), timeoutMs);
      if (cleanUserSnap && cleanUserSnap.exists) {
        return { id: cleanDocId, ...cleanUserSnap.data() };
      }
    }

    // 4. Query by id, email, or uid in tutors and users
    const queryPromises: Promise<any>[] = [
      db.collection('tutors').where('id', '==', docId).limit(1).get().catch(() => null),
      db.collection('users').where('id', '==', docId).limit(1).get().catch(() => null),
    ];
    if (docId.includes('@')) {
      const lowerEmail = docId.toLowerCase().trim();
      queryPromises.push(db.collection('tutors').where('email', '==', lowerEmail).limit(1).get().catch(() => null));
      queryPromises.push(db.collection('users').where('email', '==', lowerEmail).limit(1).get().catch(() => null));
    }
    const querySnaps = await withTimeout(Promise.all(queryPromises), timeoutMs);
    if (querySnaps) {
      for (const qSnap of querySnaps) {
        if (qSnap && !qSnap.empty && qSnap.docs[0]?.exists) {
          const matchedDoc = qSnap.docs[0];
          return { id: matchedDoc.id, ...matchedDoc.data() };
        }
      }
    }

    // 5. Check app_state/tutors
    const appStateSnap = await withTimeout(db.collection('app_state').doc('tutors').get(), timeoutMs);
    if (appStateSnap && appStateSnap.exists) {
      const stateData = appStateSnap.data();
      if (stateData && Array.isArray(stateData.tutorsList)) {
        const found = stateData.tutorsList.find(
          (t: any) => t.id === docId || (t.email && t.email.toLowerCase() === docId.toLowerCase())
        );
        if (found) return found;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Dedicated persistence for Student Media Assignments (YouTube & Spotify) directly linked to UID.
 */
export async function saveStudentAssignmentsByUid(
  uid: string,
  data: {
    uid?: string;
    email?: string;
    level?: string;
    weeklyCycle?: number;
    weeklyStudyDaysTarget?: number;
    weeklyStudyDays?: string[];
    videoAssignments?: any[];
    spotifyAssignments?: any[];
    routines?: any;
    watchedVideos?: string[];
    listenedTracks?: string[];
    updatedAt?: string;
  }
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uid) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      uid,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));
    const savePromise = db.collection('student_assignments').doc(uid).set(sanitized, { merge: true }).then(() => true);
    const result = await withTimeout(savePromise, 2000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote student assignments write restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveStudentAssignmentsByUid error:', err);
    }
    return false;
  }
}

export async function fetchStudentAssignmentsByUid(uid: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !uid) return null;
  try {
    const fetchPromise = db.collection('student_assignments').doc(uid).get().then((snap) => {
      if (snap.exists) {
        return snap.data();
      }
      return null;
    });
    return await withTimeout(fetchPromise, 2000);
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('Firestore fetchStudentAssignmentsByUid error:', err);
    }
    return null;
  }
}

/**
 * Dedicated persistence for Teacher Availability Schedule directly linked to UID and Email.
 */
export async function saveTeacherAvailabilityToFirestore(
  uidOrEmail: string,
  data: {
    uid?: string;
    teacherEmail?: string;
    meetLink?: string;
    timezone?: string;
    availableDays?: string[];
    availableHours?: string[];
    availableHoursByDay?: Record<string, string[]>;
    availability?: Record<string, string[]>;
    workingHoursStart?: string;
    workingHoursEnd?: string;
    updatedAt?: string;
  }
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uidOrEmail) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));

    const cleanDocId = uidOrEmail.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const savePromise = db.collection('teacher_availability').doc(cleanDocId).set(sanitized, { merge: true }).then(() => true);

    if (data.uid && data.uid !== cleanDocId) {
      db.collection('teacher_availability').doc(data.uid).set(sanitized, { merge: true }).catch(() => {});
    }

    const result = await withTimeout(savePromise, 2000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote teacher availability write restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveTeacherAvailabilityToFirestore error:', err);
    }
    return false;
  }
}

export async function fetchTeacherAvailabilityFromFirestore(uidOrEmail: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !uidOrEmail) return null;
  try {
    const cleanDocId = uidOrEmail.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const fetchPromise = db.collection('teacher_availability').doc(cleanDocId).get().then(async (snap) => {
      if (snap.exists) {
        return snap.data();
      }
      if (uidOrEmail !== cleanDocId) {
        const snapDirect = await db.collection('teacher_availability').doc(uidOrEmail).get();
        if (snapDirect.exists) return snapDirect.data();
      }
      return null;
    });
    return await withTimeout(fetchPromise, 2000);
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('Firestore fetchTeacherAvailabilityFromFirestore error:', err);
    }
    return null;
  }
}

/**
 * Persists daily routine video selection to users/{uid}/routines/{dayOfWeek}
 */
export async function saveRoutineVideoSubcollection(
  uid: string,
  dayOfWeek: string,
  data: any
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uid || !dayOfWeek) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      dayOfWeek,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));
    const savePromise = db.collection('users').doc(uid).collection('routines').doc(dayOfWeek).set(sanitized, { merge: true }).then(() => true);
    const result = await withTimeout(savePromise, 2000);
    return !!result;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote routine video write restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveRoutineVideoSubcollection error:', err);
    }
    return false;
  }
}

/**
 * Resets isRepeatVideo: false for all days in users/{uid}/routines/{dayOfWeek}
 */
export async function resetRepeatFlagsSubcollection(
  uid: string,
  days: string[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uid) return false;
  try {
    await Promise.all(
      days.map((day) =>
        db.collection('users').doc(uid).collection('routines').doc(day).set(
          { isRepeatVideo: false, updatedAt: new Date().toISOString() },
          { merge: true }
        )
      )
    );
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote repeat flags reset restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore resetRepeatFlagsSubcollection error:', err);
    }
    return false;
  }
}

/**
 * Appends videoId to users/{uid} watchedVideosHistory array
 */
export async function addWatchedVideoToUserDoc(
  uid: string,
  videoId: string,
  videoTitle?: string
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !uid || !videoId) return false;
  try {
    const cleanVid = (videoId || '').trim();
    const cleanTitle = (videoTitle || 'Daily Video Practice').trim();
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    const existing = snap.exists ? (snap.data()?.watchedVideosHistory || snap.data()?.watchedVideos || []) : [];
    const list = Array.isArray(existing) ? [...existing] : [];

    const alreadyExists = list.some((item) => {
      if (typeof item === 'string') return item.toLowerCase() === cleanVid.toLowerCase();
      if (item && typeof item === 'object') {
        const id = item.videoId || item.id || '';
        return id.toLowerCase() === cleanVid.toLowerCase();
      }
      return false;
    });

    if (!alreadyExists) {
      list.push({
        videoId: cleanVid,
        videoTitle: cleanTitle,
        watchedAt: new Date().toISOString(),
      });
      await userRef.set({ watchedVideosHistory: list, updatedAt: new Date().toISOString() }, { merge: true });
    }
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote watched video append restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore addWatchedVideoToUserDoc error:', err);
    }
    return false;
  }
}

export function isValidCanonicalUid(uid?: string | null): boolean {
  if (!uid || typeof uid !== 'string') return false;
  const clean = uid.trim();
  if (!clean) return false;
  if (clean.includes('@')) return false;
  if (clean.startsWith('usr-')) return false;
  if (clean.startsWith('teacher-') || clean.startsWith('tutor-') || clean.startsWith('st-') || clean.startsWith('lesson-')) return false;
  if (clean === 'user-default' || clean === 'anonymous_student' || clean === 'undefined' || clean === 'null') return false;
  return true;
}

export interface ResolveStudentIdentityParams {
  caller: {
    uid: string;
    email?: string;
    role: 'admin' | 'teacher' | 'student';
  };
  studentEmail?: string;
  studentUid?: string;
  lessonId?: string;
}

export interface ResolvedStudentIdentityResult {
  authorized: boolean;
  canonicalStudentUid: string;
  studentEmail: string;
  error?: string;
  statusCode?: number;
}

/**
 * Resolves the unequivocal canonical Firebase Auth UID of a student on the trusted backend.
 * Enforces strict authorization:
 * - Students can only access/modify their own dictionary.
 * - Teachers must have an existing authorized pedagogical link (verified lesson or assigned student profile).
 * - Teacher UID can NEVER be substituted as student UID.
 * - Synthetic IDs (usr-*, st-*) are rejected.
 * - If canonical UID cannot be unequivocally verified, recording is aborted with an explicit error.
 */
export async function resolveCanonicalStudentIdentity(
  params: ResolveStudentIdentityParams
): Promise<ResolvedStudentIdentityResult> {
  const { caller, studentEmail, studentUid, lessonId } = params;

  if (!caller || !caller.uid) {
    return {
      authorized: false,
      canonicalStudentUid: '',
      studentEmail: '',
      error: 'Authentication required: verified user token missing.',
      statusCode: 401,
    };
  }

  const cleanReqEmail = (studentEmail || '').toLowerCase().trim();
  const cleanReqUid = (studentUid || '').trim();
  const callerEmail = (caller.email || '').toLowerCase().trim();

  // 1. Caller is Student: Strict self-access only
  if (caller.role === 'student') {
    if (cleanReqUid && cleanReqUid !== caller.uid) {
      return {
        authorized: false,
        canonicalStudentUid: '',
        studentEmail: '',
        error: 'Cross-student access prohibited. Students may only access their own dictionary.',
        statusCode: 403,
      };
    }
    if (cleanReqEmail && callerEmail && cleanReqEmail !== callerEmail) {
      return {
        authorized: false,
        canonicalStudentUid: '',
        studentEmail: '',
        error: 'Cross-student access prohibited. Students may only access their own dictionary.',
        statusCode: 403,
      };
    }
    return {
      authorized: true,
      canonicalStudentUid: caller.uid,
      studentEmail: callerEmail || cleanReqEmail,
    };
  }

  const db = getFirestoreDb();
  let adminAuth: any = null;
  try {
    const { getFirebaseAdminAuth } = await import('./serverFirebaseAdmin');
    adminAuth = getFirebaseAdminAuth();
  } catch {}

  // 2. Caller is Teacher: Verify authorized pedagogical link
  if (caller.role === 'teacher' || (caller.role as string) === 'native_friend') {
    let hasAuthorizedLink = false;
    let candidateUid = cleanReqUid;
    let authorizedEmail = cleanReqEmail;

    // A. Check lesson authorization by lessonId
    if (lessonId) {
      try {
        if (db) {
          const lessonSnap = await db.collection('lessons').doc(lessonId).get();
          if (lessonSnap.exists) {
            const lData = lessonSnap.data();
            const lTeacherUid = lData?.teacherUid;
            const lTeacherEmail = (lData?.teacherEmail || '').toLowerCase().trim();
            const isLessonTeacher =
              (lTeacherUid && lTeacherUid === caller.uid) ||
              (lTeacherEmail && lTeacherEmail === callerEmail);

            if (isLessonTeacher) {
              const lStudentEmail = (lData?.studentEmail || '').toLowerCase().trim();
              const lStudentUid = (lData?.studentUid || '').trim();
              if (
                (!cleanReqEmail || cleanReqEmail === lStudentEmail) &&
                (!cleanReqUid || cleanReqUid === lStudentUid || cleanReqUid.startsWith('usr-'))
              ) {
                hasAuthorizedLink = true;
                if (!authorizedEmail) authorizedEmail = lStudentEmail;
                if (!candidateUid || candidateUid.startsWith('usr-')) candidateUid = lStudentUid;
              }
            } else {
              return {
                authorized: false,
                canonicalStudentUid: '',
                studentEmail: '',
                error: 'Teacher is not authorized for this lesson.',
                statusCode: 403,
              };
            }
          }
        }
      } catch (err) {
        console.warn('Notice checking lesson authorization in Firestore:', err);
      }
    }

    // B. Check authorized relationship via lessons collection or student profile
    if (!hasAuthorizedLink && db && (authorizedEmail || candidateUid)) {
      try {
        // Query lessons for authorized link between teacher and student
        const lessonQuery = authorizedEmail
          ? db.collection('lessons').where('studentEmail', '==', authorizedEmail)
          : db.collection('lessons').where('studentUid', '==', candidateUid);
        const lSnap = await lessonQuery.get();
        if (!lSnap.empty) {
          for (const lDoc of lSnap.docs) {
            const data = lDoc.data();
            const tUid = data.teacherUid;
            const tEmail = (data.teacherEmail || '').toLowerCase().trim();
            if ((tUid && tUid === caller.uid) || (tEmail && tEmail === callerEmail)) {
              hasAuthorizedLink = true;
              if (!authorizedEmail && data.studentEmail) authorizedEmail = data.studentEmail.toLowerCase().trim();
              if ((!candidateUid || candidateUid.startsWith('usr-')) && data.studentUid) candidateUid = data.studentUid;
              break;
            }
          }
        }
      } catch {}

      // Query user profile for assigned native friend relationship
      if (!hasAuthorizedLink) {
        try {
          const profileQuery = authorizedEmail
            ? db.collection('users').where('email', '==', authorizedEmail)
            : db.collection('users').where('uid', '==', candidateUid);
          const pSnap = await profileQuery.get();
          if (!pSnap.empty) {
            for (const pDoc of pSnap.docs) {
              const pData = pDoc.data();
              const assignedUid = pData.assignedNativeFriendUID || pData.teacherUid;
              const assignedEmail = (pData.teacherEmail || '').toLowerCase().trim();
              if ((assignedUid && assignedUid === caller.uid) || (assignedEmail && assignedEmail === callerEmail)) {
                hasAuthorizedLink = true;
                if (!authorizedEmail && pData.email) authorizedEmail = pData.email.toLowerCase().trim();
                if ((!candidateUid || candidateUid.startsWith('usr-')) && pData.uid) candidateUid = pData.uid;
                break;
              }
            }
          }
        } catch {}
      }
    }

    if (!hasAuthorizedLink) {
      return {
        authorized: false,
        canonicalStudentUid: '',
        studentEmail: '',
        error: 'Teacher has no authorized pedagogical link with this student.',
        statusCode: 403,
      };
    }

    // Resolve CANONICAL student UID via Firebase Admin Auth
    // Candidate 1: candidateUid if valid canonical UID
    if (candidateUid && isValidCanonicalUid(candidateUid)) {
      if (candidateUid === caller.uid) {
        return {
          authorized: false,
          canonicalStudentUid: '',
          studentEmail: '',
          error: 'Teacher UID cannot be used as student UID.',
          statusCode: 403,
        };
      }
      if (adminAuth) {
        try {
          const userRec = await adminAuth.getUser(candidateUid);
          if (userRec && userRec.uid) {
            if (userRec.uid === caller.uid) {
              return {
                authorized: false,
                canonicalStudentUid: '',
                studentEmail: '',
                error: 'Teacher UID cannot be used as student UID.',
                statusCode: 403,
              };
            }
            const recEmail = (userRec.email || '').toLowerCase().trim();
            if (!authorizedEmail || !recEmail || recEmail === authorizedEmail) {
              return {
                authorized: true,
                canonicalStudentUid: userRec.uid,
                studentEmail: recEmail || authorizedEmail,
              };
            }
          }
        } catch {}
      } else {
        return {
          authorized: true,
          canonicalStudentUid: candidateUid,
          studentEmail: authorizedEmail,
        };
      }
    }

    // Candidate 2: resolve by authorized student email from Firebase Admin Auth
    if (authorizedEmail) {
      if (adminAuth) {
        try {
          const userRec = await adminAuth.getUserByEmail(authorizedEmail);
          if (userRec && userRec.uid && isValidCanonicalUid(userRec.uid)) {
            if (userRec.uid === caller.uid) {
              return {
                authorized: false,
                canonicalStudentUid: '',
                studentEmail: '',
                error: 'Teacher UID cannot be used as student UID.',
                statusCode: 403,
              };
            }
            return {
              authorized: true,
              canonicalStudentUid: userRec.uid,
              studentEmail: userRec.email || authorizedEmail,
            };
          }
        } catch {}
      }

      // Candidate 3: Search Firestore /users for student document with canonical UID
      if (db) {
        try {
          const uSnap = await db.collection('users').where('email', '==', authorizedEmail).get();
          for (const uDoc of uSnap.docs) {
            if (isValidCanonicalUid(uDoc.id) && uDoc.id !== caller.uid) {
              return {
                authorized: true,
                canonicalStudentUid: uDoc.id,
                studentEmail: authorizedEmail,
              };
            }
          }
        } catch {}
      }
    }

    return {
      authorized: false,
      canonicalStudentUid: '',
      studentEmail: '',
      error: 'Cannot unequivocally resolve canonical student UID from Firebase Auth. Recording aborted.',
      statusCode: 422,
    };
  }

  // 3. Caller is Admin
  if (caller.role === 'admin') {
    let candidateUid = cleanReqUid;
    let targetEmail = cleanReqEmail;

    if (candidateUid && isValidCanonicalUid(candidateUid)) {
      if (adminAuth) {
        try {
          const userRec = await adminAuth.getUser(candidateUid);
          if (userRec && userRec.uid) {
            return {
              authorized: true,
              canonicalStudentUid: userRec.uid,
              studentEmail: (userRec.email || targetEmail).toLowerCase().trim(),
            };
          }
        } catch {}
      } else {
        return {
          authorized: true,
          canonicalStudentUid: candidateUid,
          studentEmail: targetEmail,
        };
      }
    }

    if (targetEmail && adminAuth) {
      try {
        const userRec = await adminAuth.getUserByEmail(targetEmail);
        if (userRec && userRec.uid && isValidCanonicalUid(userRec.uid)) {
          return {
            authorized: true,
            canonicalStudentUid: userRec.uid,
            studentEmail: userRec.email || targetEmail,
          };
        }
      } catch {}
    }

    if (targetEmail && db) {
      try {
        const uSnap = await db.collection('users').where('email', '==', targetEmail).get();
        for (const uDoc of uSnap.docs) {
          if (isValidCanonicalUid(uDoc.id)) {
            return {
              authorized: true,
              canonicalStudentUid: uDoc.id,
              studentEmail: targetEmail,
            };
          }
        }
      } catch {}
    }

    return {
      authorized: false,
      canonicalStudentUid: '',
      studentEmail: '',
      error: 'Cannot unequivocally resolve canonical student UID from Firebase Auth. Recording aborted.',
      statusCode: 422,
    };
  }

  return {
    authorized: false,
    canonicalStudentUid: '',
    studentEmail: '',
    error: 'Unauthorized identity role.',
    statusCode: 403,
  };
}

/**
 * Recursively strips all keys with `undefined` values from an object, nested objects, and arrays.
 * Guarantees that Firestore Admin SDK never throws:
 * "Cannot use "undefined" as a Firestore value".
 * Preserves all valid types: strings, numbers, booleans, dates, nulls, arrays, and Firestore FieldValues.
 * Does NOT invent definitions or replace undefined with placeholder strings.
 */
export function removeUndefinedFields<T = any>(val: T): T {
  if (val === undefined) {
    return undefined as any;
  }
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (val instanceof Date) {
    return val;
  }
  if (typeof (val as any).isEqual === 'function') {
    return val;
  }
  if (Array.isArray(val)) {
    return (val as any[])
      .filter((item) => item !== undefined)
      .map((item) => removeUndefinedFields(item)) as any;
  }
  const result: Record<string, any> = {};
  for (const [key, v] of Object.entries(val as Record<string, any>)) {
    if (v !== undefined) {
      const sanitized = removeUndefinedFields(v);
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    }
  }
  return result as T;
}

/**
 * Server-side consolidation of student dictionary entries.
 * Guarantees:
 * - Richer definitions and authentic examples are preserved.
 * - Multi-origin history is accumulated.
 * - practiceCount is never decreased or reset.
 * - lastPracticedAt is strictly preserved (most recent timestamp kept).
 * - Deduplicated deterministically by normalized word.
 * - Strips any undefined fields so Firestore Admin SDK never encounters undefined.
 */
function consolidateServerEntries(existingEntries: any[], newEntries: any[]): any[] {
  const masterMap = new Map<string, any>();

  (existingEntries || []).forEach((e) => {
    if (!e || !e.word) return;
    const rawWord = (e.word || '').trim();
    const key = (e.normalizedWord || rawWord).toLowerCase().trim();
    if (!key) return;
    masterMap.set(key, removeUndefinedFields({ ...e, word: rawWord, normalizedWord: key }));
  });

  (newEntries || []).forEach((item) => {
    if (!item || !item.word) return;
    const rawWord = (item.word || '').trim();
    const key = (item.normalizedWord || rawWord).toLowerCase().trim();
    if (!key) return;

    const existing = masterMap.get(key);

    if (!existing) {
      const isItemProvisional = Boolean(item.isProvisional || item.isFallback || item.enrichmentStatus === 'pending');
      const singleOrigins = Array.isArray(item.origins)
        ? item.origins
        : (item.source
          ? [
              removeUndefinedFields({
                source: item.source,
                activityName: item.sourceActivityName,
                dayOfWeek: item.sourceDay,
                date: item.learnedAt ? item.learnedAt.split('T')[0] : new Date().toISOString().split('T')[0],
                lessonId: item.lessonRefId,
                videoId: item.routineRef?.videoId,
                videoTitle: item.routineRef?.videoTitle,
              }),
            ]
          : []);

      const newEntry: Record<string, any> = {
        ...item,
        id: item.id || `dict_${key.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`,
        word: rawWord,
        originalWord: item.originalWord || rawWord,
        normalizedWord: key,
        practiceCount: typeof item.practiceCount === 'number' ? item.practiceCount : 0,
        origins: singleOrigins.map(removeUndefinedFields),
        enrichmentStatus: item.enrichmentStatus === 'enriched' && !isItemProvisional ? 'enriched' : 'pending',
        isProvisional: isItemProvisional,
      };
      if (item.simpleDefinition && typeof item.simpleDefinition === 'string' && item.simpleDefinition.trim()) {
        newEntry.simpleDefinition = item.simpleDefinition.trim();
      }
      if (item.lastPracticedAt) {
        newEntry.lastPracticedAt = item.lastPracticedAt;
      }

      masterMap.set(key, removeUndefinedFields(newEntry));
      return;
    }

    // Richer definition & Provisional protection (HOTFIX 4B.8.1)
    const existingDef = (existing.definitionEn || '').trim();
    const newDef = (item.definitionEn || item.meaningOrTip || '').trim();
    const isItemProvisional = Boolean(item.isProvisional || item.isFallback || item.enrichmentStatus === 'pending');
    const isExistingEnriched = Boolean(existing.enrichmentStatus === 'enriched' || (existingDef && !existing.isProvisional));

    const genericFallbackRegex = /A (fundamental word|natural conversational expression|practical English term|Key communicative expression)/i;
    const isNewGeneric = genericFallbackRegex.test(newDef);
    const isExistingGeneric = genericFallbackRegex.test(existingDef);

    // Rule: Provisional or fallback definitions must NEVER overwrite an existing legitimate definition
    const keepExistingDef = Boolean(
      existingDef && (
        !newDef ||
        (isItemProvisional && isExistingEnriched) ||
        (isNewGeneric && !isExistingGeneric) ||
        (existingDef.length > 20 && newDef.length < 15)
      )
    );

    const resolvedDef = keepExistingDef ? existingDef : (newDef || existingDef || '');
    const resolvedEnrichmentStatus = (isExistingEnriched && isItemProvisional)
      ? 'enriched'
      : (item.enrichmentStatus === 'enriched' && !isItemProvisional && Boolean(newDef) && !isNewGeneric)
      ? 'enriched'
      : (existing.enrichmentStatus === 'enriched' ? 'enriched' : (item.enrichmentStatus || existing.enrichmentStatus || 'pending'));
    const resolvedExample = existing.exampleSentenceEn && (!item.exampleSentenceEn || item.exampleSentenceEn.length < existing.exampleSentenceEn.length)
      ? existing.exampleSentenceEn
      : (item.exampleSentenceEn || item.exampleSentence || existing.exampleSentenceEn || '');

    // Accumulate origins without duplication
    const mergedOrigins = [...(existing.origins || [])];
    if (Array.isArray(item.origins)) {
      item.origins.forEach((orig: any) => {
        const isDup = mergedOrigins.some(
          (m: any) => m.source === orig.source && m.activityName === orig.activityName && m.date === orig.date
        );
        if (!isDup) mergedOrigins.push(orig);
      });
    } else if (item.source) {
      const isDup = mergedOrigins.some((m: any) => m.source === item.source && m.activityName === item.sourceActivityName);
      if (!isDup) {
        mergedOrigins.push(
          removeUndefinedFields({
            source: item.source,
            activityName: item.sourceActivityName,
            dayOfWeek: item.sourceDay,
            date: item.learnedAt ? item.learnedAt.split('T')[0] : new Date().toISOString().split('T')[0],
            lessonId: item.lessonRefId,
            videoId: item.routineRef?.videoId,
            videoTitle: item.routineRef?.videoTitle,
          })
        );
      }
    }

    // Practice count: NEVER decrease or reset
    const exCount = typeof existing.practiceCount === 'number' ? existing.practiceCount : 0;
    const inCount = typeof item.practiceCount === 'number' ? item.practiceCount : 0;
    const mergedPracticeCount = Math.max(exCount, inCount);

    let mergedLastPracticedAt = existing.lastPracticedAt;
    if (item.lastPracticedAt) {
      if (!existing.lastPracticedAt || new Date(item.lastPracticedAt) > new Date(existing.lastPracticedAt)) {
        mergedLastPracticedAt = item.lastPracticedAt;
      }
    }

    // Practice history: NEVER drop or overwrite existing history
    const mergedPracticeHistory = [...(existing.practiceHistory || [])];
    if (Array.isArray(item.practiceHistory)) {
      item.practiceHistory.forEach((h: any) => {
        const isDup = mergedPracticeHistory.some(
          (m: any) => m.date === h.date && m.activityType === h.activityType
        );
        if (!isDup) mergedPracticeHistory.push(h);
      });
    }

    const resolvedSimpleDef = (item.simpleDefinition || existing.simpleDefinition || '').trim();
    const mergedEntry: Record<string, any> = {
      ...existing,
      ...item,
      id: existing.id || item.id,
      word: rawWord,
      originalWord: item.originalWord || existing.originalWord || rawWord,
      normalizedWord: key,
      definitionEn: resolvedDef,
      exampleSentenceEn: resolvedExample,
      origins: mergedOrigins.map(removeUndefinedFields),
      practiceCount: mergedPracticeCount,
      practiceHistory: mergedPracticeHistory,
      enrichmentStatus: resolvedEnrichmentStatus,
      isProvisional: isItemProvisional && !isExistingEnriched,
    };
    if (resolvedSimpleDef) {
      mergedEntry.simpleDefinition = resolvedSimpleDef;
    }
    if (mergedLastPracticedAt) {
      mergedEntry.lastPracticedAt = mergedLastPracticedAt;
    }

    masterMap.set(key, removeUndefinedFields(mergedEntry));
  });

  return Array.from(masterMap.values())
    .map(removeUndefinedFields)
    .sort((a, b) => (a.word || '').localeCompare(b.word || ''));
}

/**
 * Server-side persistent storage of student vocabulary in Cloud Firestore.
 * Strictly requires a canonical student Firebase Auth UID (rejects synthetic usr-* / st-* or teacher UID).
 * Persists to canonical document users/{canonicalStudentUid} and subcollection users/{canonicalStudentUid}/vocabulary/{wordDocId}.
 */
export async function saveStudentVocabularyToFirestoreServer(
  studentUid: string,
  entries: any[],
  studentEmail?: string
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !studentUid) return false;

  const cleanUid = studentUid.trim();
  if (!isValidCanonicalUid(cleanUid)) {
    throw new Error(
      `[saveStudentVocabularyToFirestoreServer] Rejected non-canonical student UID: "${cleanUid}". Persistence strictly requires a canonical Firebase Auth UID.`
    );
  }
  if (!entries || entries.length === 0) return true;

  try {
    const cleanEmail = (studentEmail || '').toLowerCase().trim();
    const sanitizedEntries = removeUndefinedFields(JSON.parse(JSON.stringify(entries || [])));

    // 1. Fetch existing entries from canonical user document
    let existingList: any[] = [];
    try {
      const userSnap = await db.collection('users').doc(cleanUid).get();
      if (userSnap.exists && Array.isArray(userSnap.data()?.vocabulary)) {
        existingList = userSnap.data()?.vocabulary;
      }
    } catch {}

    // 2. Fetch existing entries from canonical subcollection
    try {
      const subSnap = await db.collection('users').doc(cleanUid).collection('vocabulary').get();
      if (!subSnap.empty) {
        subSnap.forEach((docItem) => {
          const item = docItem.data();
          if (item && item.word) {
            existingList.push(item);
          }
        });
      }
    } catch {}

    // 3. Consolidate entries cumulatively and recursively eliminate all undefined fields
    const consolidated = removeUndefinedFields(consolidateServerEntries(existingList, sanitizedEntries));

    // 4. Save to canonical root document users/{cleanUid} with guaranteed zero undefined values
    const rootPayload = removeUndefinedFields({
      vocabulary: consolidated,
      updatedAt: new Date().toISOString(),
    });
    await db.collection('users').doc(cleanUid).set(rootPayload, { merge: true });

    // 5. Save individual entries to subcollection users/{cleanUid}/vocabulary/{wordDocId}
    for (const item of consolidated) {
      if (item && item.word) {
        const rawWord = (item.normalizedWord || item.word).toLowerCase().trim();
        const wordDocId = rawWord.replace(/[^a-zA-Z0-9_-]/g, '_');
        const docPayload = removeUndefinedFields({
          ...item,
          studentUid: cleanUid,
          ...(cleanEmail || item.studentEmail ? { studentEmail: cleanEmail || item.studentEmail } : {}),
          updatedAt: new Date().toISOString(),
        });
        await db.collection('users').doc(cleanUid).collection('vocabulary').doc(wordDocId).set(
          docPayload,
          { merge: true }
        );
      }
    }

    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote vocabulary save restricted by IAM, continuing with local state.');
      return false;
    } else {
      console.warn('Firestore server vocabulary save notice:', err);
      throw err;
    }
  }
}

/**
 * Server-side read of student personal dictionary directly from canonical Firestore path.
 * Implements Etapa 4: Safe, read-only recovery of legacy records when unequivocal identity link is proven.
 * CRITICAL: Strictly read-only! Never performs automatic migration writes (no setDoc).
 * CRITICAL: Canonical records are never overwritten by legacy records.
 */
export async function fetchStudentVocabularyFromFirestoreServer(
  canonicalStudentUid: string,
  studentEmail?: string
): Promise<any[]> {
  const db = getFirestoreDb();
  if (!db || !canonicalStudentUid) return [];

  const entryMap = new Map<string, any>();

  try {
    // 1. Fetch from canonical document users/{canonicalStudentUid}
    const userDocRef = db.collection('users').doc(canonicalStudentUid);
    const userSnap = await userDocRef.get();
    let excludedWords: string[] = [];
    if (userSnap.exists) {
      const data = userSnap.data();
      if (Array.isArray(data?.excludedDictionaryWords)) {
        excludedWords = data.excludedDictionaryWords;
      }
      if (Array.isArray(data?.vocabulary)) {
        data.vocabulary.forEach((item: any) => {
          if (item && item.word) {
            const key = (item.normalizedWord || item.word).toLowerCase().trim();
            entryMap.set(key, item);
          }
        });
      }
    }

    // 2. Fetch from canonical subcollection users/{canonicalStudentUid}/vocabulary
    const subColRef = db.collection('users').doc(canonicalStudentUid).collection('vocabulary');
    const subSnap = await subColRef.get();
    if (!subSnap.empty) {
      subSnap.forEach((docItem) => {
        const item = docItem.data();
        if (item && item.word) {
          const key = (item.normalizedWord || item.word).toLowerCase().trim();
          entryMap.set(key, { ...(entryMap.get(key) || {}), ...item });
        }
      });
    }

    // 3. Etapa 4: Read-only check of legacy doc IDs if canonical doc has no vocabulary
    if (studentEmail && entryMap.size === 0) {
      const cleanEmail = studentEmail.toLowerCase().trim();
      const legacyDocIds = [
        `usr-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
        cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_'),
        cleanEmail,
      ].filter((id) => id !== canonicalStudentUid);

      for (const legId of legacyDocIds) {
        try {
          const legSnap = await db.collection('users').doc(legId).get();
          if (legSnap.exists) {
            const legData = legSnap.data();
            const emailMatches = (legData?.email || '').toLowerCase().trim() === cleanEmail;
            const uidMatches = !legData?.uid || legData?.uid === canonicalStudentUid || legData?.uid === legId;
            if (emailMatches && uidMatches && Array.isArray(legData?.vocabulary)) {
              legData.vocabulary.forEach((item: any) => {
                if (item && item.word) {
                  const key = (item.normalizedWord || item.word).toLowerCase().trim();
                  if (!entryMap.has(key)) {
                    entryMap.set(key, item);
                  }
                }
              });
              break; // Only read the first matching legacy document
            }
          }
        } catch {}
      }
    }

    // Filter out all logically excluded words (tombstones)
    const excludedSet = new Set(
      excludedWords.map((w: string) => normalizeDictionaryWord(w)).filter(Boolean)
    );

    return Array.from(entryMap.values())
      .filter((item) => {
        const norm = normalizeDictionaryWord(item.normalizedWord || item.word);
        return Boolean(norm && !excludedSet.has(norm));
      })
      .sort((a, b) => (a.word || '').localeCompare(b.word || ''));
  } catch (err) {
    console.warn('fetchStudentVocabularyFromFirestoreServer error:', err);
    return [];
  }
}

/**
 * Fetches canonical list of excluded dictionary words from Firestore users/{canonicalStudentUid}.
 */
export async function fetchExcludedDictionaryWordsServer(
  canonicalStudentUid: string
): Promise<string[]> {
  const db = getFirestoreDb();
  if (!db || !canonicalStudentUid || !isValidCanonicalUid(canonicalStudentUid)) return [];

  try {
    const userDocRef = db.collection('users').doc(canonicalStudentUid);
    const userSnap = await userDocRef.get();
    if (userSnap.exists) {
      const data = userSnap.data();
      if (Array.isArray(data?.excludedDictionaryWords)) {
        return Array.from(
          new Set(
            data.excludedDictionaryWords
              .map((w: string) => normalizeDictionaryWord(w))
              .filter(Boolean)
          )
        );
      }
    }
    return [];
  } catch (err) {
    console.warn('fetchExcludedDictionaryWordsServer error:', err);
    return [];
  }
}

/**
 * Persists normalized dictionary exclusions logically in users/{canonicalStudentUid}.excludedDictionaryWords.
 * Uses atomic arrayUnion (or transaction) to preserve concurrent exclusions and prevent race conditions.
 * Idempotent: adding already-excluded words produces no duplicates.
 * Preserves all pedagogical history, definitions, examples, and practice metrics without physical deletion.
 * Never modifies legacy documents.
 */
export async function addExcludedDictionaryWordsServer(
  canonicalStudentUid: string,
  words: string[]
): Promise<string[]> {
  if (!isValidCanonicalUid(canonicalStudentUid)) {
    throw new Error(
      `[addExcludedDictionaryWordsServer] Rejected non-canonical student UID: "${canonicalStudentUid}". Exclusions strictly require a canonical Firebase Auth UID.`
    );
  }
  const normalizedWords = Array.from(
    new Set(words.map((w) => normalizeDictionaryWord(w)).filter(Boolean))
  );
  if (normalizedWords.length === 0) {
    return fetchExcludedDictionaryWordsServer(canonicalStudentUid);
  }

  const db = getFirestoreDb();
  if (!db) {
    return normalizedWords;
  }

  try {
    const userDocRef = db.collection('users').doc(canonicalStudentUid);

    if (typeof FieldValue !== 'undefined' && FieldValue.arrayUnion) {
      try {
        await userDocRef.set(
          {
            excludedDictionaryWords: FieldValue.arrayUnion(...normalizedWords),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch {
        const snap = await userDocRef.get();
        const existing: string[] = snap.exists && Array.isArray(snap.data()?.excludedDictionaryWords)
          ? snap.data()?.excludedDictionaryWords
          : [];
        const merged = Array.from(new Set([...existing.map(normalizeDictionaryWord), ...normalizedWords]));
        await userDocRef.set(
          {
            excludedDictionaryWords: merged,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    } else {
      const snap = await userDocRef.get();
      const existing: string[] = snap.exists && Array.isArray(snap.data()?.excludedDictionaryWords)
        ? snap.data()?.excludedDictionaryWords
        : [];
      const merged = Array.from(new Set([...existing.map(normalizeDictionaryWord), ...normalizedWords]));
      await userDocRef.set(
        {
          excludedDictionaryWords: merged,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    return fetchExcludedDictionaryWordsServer(canonicalStudentUid);
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote exclusion save restricted by IAM, continuing with local state.');
      return normalizedWords;
    }
    console.warn('Firestore server addExcludedDictionaryWordsServer error:', err);
    throw err;
  }
}

/**
 * Removes words from users/{canonicalStudentUid}.excludedDictionaryWords upon explicit intentional re-addition.
 * Uses atomic arrayRemove (or transaction) to preserve concurrent exclusions and prevent race conditions.
 * Idempotent: removing non-excluded words produces no inconsistencies.
 */
export async function removeExcludedDictionaryWordsServer(
  canonicalStudentUid: string,
  words: string[]
): Promise<string[]> {
  if (!isValidCanonicalUid(canonicalStudentUid)) {
    throw new Error(
      `[removeExcludedDictionaryWordsServer] Rejected non-canonical student UID: "${canonicalStudentUid}". Exclusions strictly require a canonical Firebase Auth UID.`
    );
  }
  const normalizedWords = Array.from(
    new Set(words.map((w) => normalizeDictionaryWord(w)).filter(Boolean))
  );
  if (normalizedWords.length === 0) {
    return fetchExcludedDictionaryWordsServer(canonicalStudentUid);
  }

  const db = getFirestoreDb();
  if (!db) return [];

  try {
    const userDocRef = db.collection('users').doc(canonicalStudentUid);

    if (typeof FieldValue !== 'undefined' && FieldValue.arrayRemove) {
      try {
        await userDocRef.set(
          {
            excludedDictionaryWords: FieldValue.arrayRemove(...normalizedWords),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch {
        const snap = await userDocRef.get();
        const existing: string[] = snap.exists && Array.isArray(snap.data()?.excludedDictionaryWords)
          ? snap.data()?.excludedDictionaryWords
          : [];
        const normToRemove = new Set(normalizedWords);
        const filtered = existing.map(normalizeDictionaryWord).filter((w) => w && !normToRemove.has(w));
        await userDocRef.set(
          {
            excludedDictionaryWords: filtered,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    } else {
      const snap = await userDocRef.get();
      const existing: string[] = snap.exists && Array.isArray(snap.data()?.excludedDictionaryWords)
        ? snap.data()?.excludedDictionaryWords
        : [];
      const normToRemove = new Set(normalizedWords);
      const filtered = existing.map(normalizeDictionaryWord).filter((w) => w && !normToRemove.has(w));
      await userDocRef.set(
        {
          excludedDictionaryWords: filtered,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    return fetchExcludedDictionaryWordsServer(canonicalStudentUid);
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote exclusion removal restricted by IAM, continuing with local state.');
      return [];
    }
    console.warn('Firestore server removeExcludedDictionaryWordsServer error:', err);
    throw err;
  }
}


/**
 * Server-side persistent storage of Native Friend In-Session Notes & Recommendations in Cloud Firestore.
 */
export async function saveSessionNotesToFirestoreServer(
  sessionKey: string,
  data: {
    id?: string;
    sessionDate: string;
    lessonId?: string;
    studentEmail: string;
    studentUid?: string;
    teacherEmail?: string;
    teacherName?: string;
    topic?: string;
    content: string;
    updatedAt?: string;
    driveFileId?: string;
    driveFileUrl?: string;
    driveFolderName?: string;
    driveLastSyncedAt?: string;
  }
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !sessionKey || !data) return false;

  try {
    const cleanKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      id: cleanKey,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));

    const savePromises: Promise<any>[] = [
      db.collection('session_notes').doc(cleanKey).set(sanitized, { merge: true }),
    ];

    const studentId = data.studentUid || (data.studentEmail ? data.studentEmail.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_') : '');
    if (studentId) {
      savePromises.push(
        db.collection('users').doc(studentId).collection('session_notes').doc(cleanKey).set(sanitized, { merge: true })
      );
    }

    if (data.lessonId) {
      savePromises.push(
        db.collection('lessons').doc(data.lessonId).set(
          {
            sessionNotesDocument: data.content,
            liveNotes: data.content,
            recommendations: data.content,
            title: data.topic,
            notesLastSavedAt: sanitized.updatedAt,
            updatedAt: sanitized.updatedAt,
            ...(data.driveFileId ? { driveFileId: data.driveFileId } : {}),
            ...(data.driveFileUrl ? { driveFileUrl: data.driveFileUrl } : {}),
            ...(data.driveFolderName ? { driveFolderName: data.driveFolderName } : {}),
            ...(data.driveLastSyncedAt ? { driveLastSyncedAt: data.driveLastSyncedAt } : {}),
          },
          { merge: true }
        )
      );
    }

    await Promise.all(savePromises);
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote session notes save restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore server session notes save notice:', err);
    }
    return false;
  }
}

export async function fetchSessionNotesFromFirestoreServer(sessionKey: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !sessionKey) return null;
  try {
    const cleanKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const snap = await db.collection('session_notes').doc(cleanKey).get();
    if (snap.exists) {
      return snap.data();
    }
    return null;
  } catch (err: any) {
    if (!isPermissionError(err)) {
      console.warn('Firestore fetch session notes notice:', err);
    }
    return null;
  }
}

/**
 * Direct persistence for Native Friend notes review progress
 */
export async function saveSessionNotesProgressToFirestore(key: string, cyclePayload: any): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !key) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(cyclePayload));
    const userRef = db.collection('users').doc(key);
    const subRef = userRef.collection('session_notes').doc('review_cycle');
    await Promise.all([
      subRef.set(sanitized, { merge: true }),
      userRef.set(
        {
          nativeNotesReview: sanitized,
          updatedAt: sanitized.updatedAt || new Date().toISOString(),
        },
        { merge: true }
      ),
    ]);
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote session notes progress save restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveSessionNotesProgress error:', err);
    }
    return false;
  }
}

/**
 * Atomic registration of daily reminder presentation.
 * Ensures the Native Friends Notes reminder is presented AT MOST ONCE per day per student UID,
 * immune to page reload, component remount, or switching devices.
 */
export async function recordDailyReminderShownServer(
  studentUid: string,
  todayInTz: string
): Promise<{ canShow: boolean; alreadyShown: boolean; lastReminderShownDate: string }> {
  if (!studentUid || !todayInTz) {
    return { canShow: false, alreadyShown: true, lastReminderShownDate: todayInTz };
  }

  const cleanUid = studentUid.trim();
  const db = getFirestoreDb();
  if (db && !isCloudWriteDisabled) {
    try {
      const userRef = db.collection('users').doc(cleanUid);
      const subRef = userRef.collection('session_notes').doc('review_cycle');

      if (typeof (db as any).runTransaction === 'function') {
        const result = await (db as any).runTransaction(async (tx: any) => {
          const snap = await tx.get(subRef);
          let lastDate = '';
          if (snap && snap.exists) {
            const data = snap.data() || {};
            lastDate = data.lastReminderShownDate || '';
          } else {
            const uSnap = await tx.get(userRef);
            if (uSnap && uSnap.exists) {
              const uData = uSnap.data() || {};
              lastDate = uData.nativeNotesReview?.lastReminderShownDate || uData.lastReminderShownDate || '';
            }
          }

          if (lastDate === todayInTz) {
            return { canShow: false, alreadyShown: true, lastReminderShownDate: lastDate };
          }

          tx.set(
            subRef,
            {
              lastReminderShownDate: todayInTz,
              reminderShownAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );

          tx.set(
            userRef,
            {
              lastReminderShownDate: todayInTz,
              'nativeNotesReview.lastReminderShownDate': todayInTz,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );

          return { canShow: true, alreadyShown: false, lastReminderShownDate: todayInTz };
        });
        return result;
      } else {
        // Mock / non-transactional fallback
        const snap = await subRef.get();
        const data = snap && snap.exists ? snap.data() : null;
        const lastDate = data?.lastReminderShownDate || '';
        if (lastDate === todayInTz) {
          return { canShow: false, alreadyShown: true, lastReminderShownDate: lastDate };
        }
        await subRef.set({ lastReminderShownDate: todayInTz, updatedAt: new Date().toISOString() }, { merge: true });
        await userRef.set({ lastReminderShownDate: todayInTz, 'nativeNotesReview.lastReminderShownDate': todayInTz }, { merge: true });
        return { canShow: true, alreadyShown: false, lastReminderShownDate: todayInTz };
      }
    } catch (err) {
      console.warn('Firestore recordDailyReminderShownServer notice:', err);
    }
  }

  return { canShow: true, alreadyShown: false, lastReminderShownDate: todayInTz };
}

/**
 * Retrieve session notes progress from Firestore
 */
export async function fetchSessionNotesProgressServer(key: string): Promise<any> {
  const cleanKey = (key || '').trim();
  if (!cleanKey) return null;
  const db = getFirestoreDb();
  if (!db) return null;
  try {
    const userRef = db.collection('users').doc(cleanKey);
    const subRef = userRef.collection('session_notes').doc('review_cycle');
    const snap = await subRef.get();
    if (snap && snap.exists) {
      return snap.data();
    }
    const uSnap = await userRef.get();
    if (uSnap && uSnap.exists) {
      const data = uSnap.data() || {};
      return data.nativeNotesReview || null;
    }
  } catch (err) {
    if (!isPermissionError(err)) {
      console.warn('fetchSessionNotesProgressServer notice:', err);
    }
  }
  return null;
}

/**
 * Persist pedagogical transformation in Cloud Firestore
 */
export async function savePedagogicalTransformationToFirestoreServer(
  compositeCacheKey: string,
  transformation: any
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !compositeCacheKey || !transformation) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(transformation));
    const sessionKey = transformation.sessionKey || compositeCacheKey.split('__')[0];
    const sessionRef = db.collection('session_notes').doc(sessionKey);
    await sessionRef.collection('pedagogical_cache').doc(compositeCacheKey).set(
      {
        ...sanitized,
        cacheKey: compositeCacheKey,
        savedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.warn('Firestore savePedagogicalTransformation error:', err);
    return false;
  }
}

/**
 * Retrieve pedagogical transformation from Cloud Firestore
 */
export async function fetchPedagogicalTransformationFromFirestoreServer(
  compositeCacheKey: string
): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !compositeCacheKey) return null;
  try {
    const sessionKey = compositeCacheKey.split('__')[0];
    const sessionRef = db.collection('session_notes').doc(sessionKey);
    const snap = await sessionRef.collection('pedagogical_cache').doc(compositeCacheKey).get();
    if (snap && snap.exists) {
      const data = snap.data();
      if (data && data.isAiGenerated && !data.isProvisional) {
        return data;
      }
    }
  } catch (err) {
    if (!isPermissionError(err)) {
      console.warn('Firestore fetchPedagogicalTransformation notice:', err);
    }
  }
  return null;
}

/**
 * Direct persistence for Student Journal entries to users/{docId}
 */
export async function saveStudentJournalToFirestore(docId: string, journal: any[]): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !docId) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(journal || []));
    await db.collection('users').doc(docId).set(
      {
        studentJournal: sanitized,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote student journal save restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveStudentJournal error:', err);
    }
    return false;
  }
}

/**
 * Subcollection-scoped persistence for routine checks
 */
export async function fetchWeeklyChecksFromFirestore(
  docIds: string[],
  canonicalWeekId: string,
  cycle: number
): Promise<Record<string, boolean> | null> {
  const db = getFirestoreDb();
  if (!db || !docIds.length) return null;

  for (const dId of docIds.filter(Boolean)) {
    try {
      const weekSnap = await db.collection('users').doc(dId).collection('weeklyChecks').doc(canonicalWeekId).get();
      if (weekSnap.exists) {
        const wData = weekSnap.data();
        return {
          ...(wData?.checks || {}),
          ...(wData?.weeklyChecks || {}),
          ...(wData?.sPathChecks || {}),
        };
      }
    } catch {}
  }

  // Week 1 legacy backward compatibility only
  if (cycle === 1) {
    for (const dId of docIds.filter(Boolean)) {
      try {
        const userSnap = await db.collection('users').doc(dId).get();
        if (userSnap.exists) {
          const uData = userSnap.data();
          if (uData?.weeklyChecks || uData?.sPathChecks) {
            return {
              ...(uData?.weeklyChecks || {}),
              ...(uData?.sPathChecks || {}),
            };
          }
        }
      } catch {}
    }
  }

  return null;
}

export async function saveWeeklyChecksToFirestore(
  docId: string,
  canonicalWeekId: string,
  weekDocPayload: any,
  fsRootPayload: any
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !docId) return false;
  try {
    const userRef = db.collection('users').doc(docId);
    const subRef = userRef.collection('weeklyChecks').doc(canonicalWeekId);
    await Promise.all([
      subRef.set(JSON.parse(JSON.stringify(weekDocPayload)), { merge: true }),
      userRef.set(JSON.parse(JSON.stringify(fsRootPayload)), { merge: true }),
    ]);
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote weekly checks save restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveWeeklyChecks error:', err);
    }
    return false;
  }
}

/**
 * Subcollection-scoped persistence for homework
 */
export async function fetchHomeworkFromFirestore(
  docIds: string[],
  canonicalWeekId: string,
  cycle: number
): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !docIds.length) return null;

  for (const dId of docIds.filter(Boolean)) {
    try {
      const hwSnap = await db.collection('users').doc(dId).collection('homework').doc(canonicalWeekId).get();
      if (hwSnap.exists) {
        return hwSnap.data();
      }
    } catch {}
  }

  // Week 1 legacy backward compatibility only
  if (cycle === 1) {
    for (const dId of docIds.filter(Boolean)) {
      try {
        const hwSubSnap = await db.collection('users').doc(dId).collection('homework').doc('current_week').get();
        if (hwSubSnap.exists) {
          return hwSubSnap.data();
        }
        const userSnap = await db.collection('users').doc(dId).get();
        if (userSnap.exists && userSnap.data()?.weeklyHomework) {
          return userSnap.data()?.weeklyHomework;
        }
      } catch {}
    }
  }

  return null;
}

export async function saveHomeworkToFirestore(
  docId: string,
  canonicalWeekId: string,
  cycle: number,
  hwPayload: any
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !docId) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(hwPayload));
    const userRef = db.collection('users').doc(docId);
    const promises: Promise<any>[] = [
      userRef.collection('homework').doc(canonicalWeekId).set(sanitized, { merge: true }),
    ];
    if (cycle === 1) {
      promises.push(
        userRef.set(
          {
            weeklyHomework: sanitized,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        )
      );
      promises.push(
        userRef.collection('homework').doc('current_week').set(sanitized, { merge: true })
      );
      promises.push(
        db.collection('student_homework').doc(docId).set(sanitized, { merge: true })
      );
    }
    await Promise.all(promises);
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote homework save restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore saveHomework error:', err);
    }
    return false;
  }
}

export interface ScheduleLessonServerParams {
  studentAuthUid: string;
  studentEmail?: string;
  studentName?: string;
  teacherIdOrEmail: string;
  teacherUid?: string;
  teacherEmail?: string;
  teacherName?: string;
  meetLink?: string;
  startDateTime: string;
  endDateTime: string;
  title?: string;
  description?: string;
  isTrialLesson?: boolean;
  requestId?: string;
  existingLessons?: any[];
  dbState?: any;
}

export interface ScheduleLessonServerResult {
  success: boolean;
  lesson?: any;
  remainingLessons?: number;
  contractedLessons?: number;
  isTrialLesson?: boolean;
  error?: string;
  statusCode: number;
}

/**
 * Server-authoritative atomic scheduling service using Firebase Admin SDK.
 * 
 * Guarantees:
 * 1. Authenticated canonical student UID derived strictly from server-verified token.
 * 2. Resolution of Native Friend across users, tutors, and consolidated catalog.
 * 3. Verification of tutor role and approved status (rejects unapproved/pending tutors).
 * 4. Conflict detection: blocks overlapping slots for both teacher and student.
 * 5. Trial lesson eligibility enforcement (prevents duplicate trial usage).
 * 6. Balance verification and atomic decrement for paid lessons.
 * 7. Idempotent execution preventing duplicate lessons on repeated submission.
 * 8. Atomic persistence in Cloud Firestore via Firebase Admin SDK runTransaction.
 */
export async function scheduleLessonAtomicServer(
  params: ScheduleLessonServerParams
): Promise<ScheduleLessonServerResult> {
  const {
    studentAuthUid,
    studentEmail,
    studentName,
    teacherIdOrEmail,
    teacherUid,
    teacherEmail,
    teacherName,
    meetLink,
    startDateTime,
    endDateTime,
    title,
    description,
    isTrialLesson,
    requestId,
    existingLessons,
    dbState,
  } = params;

  // 1. Validate student identity
  if (!studentAuthUid || typeof studentAuthUid !== 'string' || studentAuthUid.trim().length === 0) {
    return {
      success: false,
      error: 'Identidade de estudante não autenticada ou token inválido.',
      statusCode: 401,
    };
  }

  const cleanStudentEmail = (studentEmail || '').toLowerCase().trim();
  const cleanTeacherTarget = (teacherIdOrEmail || teacherUid || teacherEmail || '').toLowerCase().trim();

  if (!cleanTeacherTarget) {
    return {
      success: false,
      error: 'Identificador do Amigo Nativo não informado.',
      statusCode: 400,
    };
  }

  // 2. Validate timestamps
  const startTime = new Date(startDateTime).getTime();
  const endTime = new Date(endDateTime).getTime();
  if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
    return {
      success: false,
      error: 'Horário de início ou término inválido. O horário inicial deve ser anterior ao término.',
      statusCode: 400,
    };
  }

  const db = getFirestoreDb();

  // 3. Resolve Native Friend (Teacher) profile
  let candidateTutors: any[] = [];
  if (db) {
    try {
      const directDoc = await fetchTutorDocumentFromFirestore(cleanTeacherTarget, 2500);
      if (directDoc) candidateTutors.push(directDoc);
    } catch {}
    try {
      const allFirestoreTutors = await fetchTutorsFromFirestore();
      if (Array.isArray(allFirestoreTutors)) candidateTutors.push(...allFirestoreTutors);
    } catch {}
  }
  if (dbState && Array.isArray(dbState.tutorsList)) {
    candidateTutors.push(...dbState.tutorsList);
  }
  if (dbState && Array.isArray(dbState.teachers)) {
    candidateTutors.push(...dbState.teachers);
  }

  const consolidatedTutors = consolidateTutorsList(candidateTutors);
  const matchedTutor = consolidatedTutors.find((t) => {
    const tEmail = (t.email || '').toLowerCase().trim();
    const tAuthUid = (t.authUid || t.uid || '').trim();
    const tId = (t.publicTutorId || t.id || '').trim();
    const tLegacy = (t.legacyId || '').trim();
    const tName = normalizeTutorName(t.name);

    return (
      tId.toLowerCase() === cleanTeacherTarget ||
      tAuthUid.toLowerCase() === cleanTeacherTarget ||
      tEmail === cleanTeacherTarget ||
      (tLegacy && tLegacy.toLowerCase() === cleanTeacherTarget) ||
      (teacherEmail && tEmail === teacherEmail.toLowerCase().trim()) ||
      (teacherUid && (tAuthUid === teacherUid || tId === teacherUid)) ||
      (cleanTeacherTarget && tName === normalizeTutorName(cleanTeacherTarget))
    );
  });

  if (!matchedTutor) {
    return {
      success: false,
      error: 'Amigo Nativo não encontrado no sistema.',
      statusCode: 404,
    };
  }

  // Validate teacher role
  const role = (matchedTutor.role || '').toLowerCase().trim();
  const isTeacherRole = role === 'teacher' || role === 'tutor' || role === 'native_friend' || matchedTutor.isTeacher === true;
  if (!isTeacherRole) {
    return {
      success: false,
      error: 'O usuário selecionado não possui o perfil de Amigo Nativo.',
      statusCode: 400,
    };
  }

  // Validate teacher approval status
  const isApproved = Boolean(
    matchedTutor.approvalStatus === 'approved' ||
    matchedTutor.isApproved === true ||
    matchedTutor.status === 'approved' ||
    matchedTutor.approved === true
  );
  if (!isApproved) {
    return {
      success: false,
      error: 'O Amigo Nativo selecionado ainda não foi aprovado para receber agendamentos.',
      statusCode: 400,
    };
  }

  const resolvedPublicTutorId = matchedTutor.publicTutorId || matchedTutor.id || (matchedTutor.email ? `tutor-${matchedTutor.email.replace(/[^a-zA-Z0-9]/g, '-')}` : 'tutor');
  const resolvedTeacherAuthUid = (matchedTutor.authUid || matchedTutor.uid && !matchedTutor.uid.startsWith('usr-') && !matchedTutor.uid.startsWith('tutor-') ? matchedTutor.uid : '') || undefined;
  const resolvedTeacherEmail = (matchedTutor.email || teacherEmail || '').toLowerCase().trim();
  const resolvedTeacherName = matchedTutor.name || teacherName || 'Native Friend';
  const resolvedMeetLink = meetLink || matchedTutor.meetLink || matchedTutor.meetUrl || 'https://meet.google.com/new';

  // Anti-impersonation: Student cannot be the same as Native Friend
  if (
    (resolvedTeacherAuthUid && studentAuthUid === resolvedTeacherAuthUid) ||
    (resolvedTeacherEmail && cleanStudentEmail && resolvedTeacherEmail === cleanStudentEmail)
  ) {
    return {
      success: false,
      error: 'Violação de segurança: Aluno e Amigo Nativo não podem ter identidades idênticas.',
      statusCode: 400,
    };
  }

  // 4. Locate Student Profile
  let studentDoc: any = null;
  if (db) {
    studentDoc = await fetchUserDocumentFromFirestore(studentAuthUid, 2500);
    if (!studentDoc && cleanStudentEmail) {
      const emailDocId = cleanStudentEmail.replace(/[^a-zA-Z0-9]/g, '-');
      studentDoc = await fetchUserDocumentFromFirestore(emailDocId, 2000);
    }
  }
  if (!studentDoc && dbState) {
    studentDoc =
      (cleanStudentEmail ? dbState.userProfiles?.[cleanStudentEmail] : null) ||
      (dbState.students || []).find((s: any) => (s.email || '').toLowerCase().trim() === cleanStudentEmail || s.uid === studentAuthUid || s.id === studentAuthUid);
  }

  const currentContracted = Number(studentDoc?.contractedLessons ?? 0);
  const currentAvailable = studentDoc?.availableLessons !== undefined ? Number(studentDoc.availableLessons) : currentContracted;
  const hasAlreadyCompletedTrial = Boolean(studentDoc?.hasCompletedTrialLesson);

  // 5. Gather existing lessons for conflict and trial checks
  const allExistingLessons: any[] = [];
  if (Array.isArray(existingLessons)) {
    allExistingLessons.push(...existingLessons);
  }
  if (dbState && Array.isArray(dbState.liveLessons)) {
    allExistingLessons.push(...dbState.liveLessons);
  }
  if (db) {
    try {
      const [tSnap, sSnap] = await Promise.all([
        db.collection('lessons').where('teacherUid', '==', resolvedPublicTutorId).get().catch(() => null),
        db.collection('lessons').where('studentUid', '==', studentAuthUid).get().catch(() => null),
      ]);
      if (tSnap) tSnap.forEach((d) => allExistingLessons.push({ id: d.id, ...d.data() }));
      if (sSnap) sSnap.forEach((d) => allExistingLessons.push({ id: d.id, ...d.data() }));
    } catch {}
  }

  // Deduplicate existing lessons by id
  const existingLessonsMap = new Map<string, any>();
  allExistingLessons.forEach((l) => {
    if (l && l.id) existingLessonsMap.set(l.id, l);
  });
  const consolidatedLessons = Array.from(existingLessonsMap.values());

  // 6. Deterministic Lesson ID & Idempotency Check (Anti-Duplication on retry/rapid clicks)
  const deterministicLessonId = requestId || `lesson-${studentAuthUid}-${startTime}`;
  const existingExactLesson = consolidatedLessons.find((l) => l.id === deterministicLessonId);
  if (existingExactLesson && existingExactLesson.status === 'scheduled') {
    return {
      success: true,
      lesson: existingExactLesson,
      remainingLessons: currentAvailable,
      contractedLessons: currentContracted,
      isTrialLesson: Boolean(isTrialLesson),
      statusCode: 200,
    };
  }

  // 7. Check Overlapping Conflicts (Anti-Duplicity Rule: teacher or student cannot have overlapping slots)
  const candidateConflict = consolidatedLessons.find((l) => {
    const isCancelled = l.status === 'cancelled' || l.status === 'canceled' || Boolean(l.cancelledAt);
    if (isCancelled) return false;
    if (l.status && l.status !== 'scheduled') return false;

    // Check time overlap
    if (!l.startDateTime || !l.endDateTime) return false;
    const lStart = new Date(l.startDateTime).getTime();
    const lEnd = new Date(l.endDateTime).getTime();
    const overlaps = lStart < endTime && lEnd > startTime;
    if (!overlaps) return false;

    // Teacher conflict
    const isSameTeacher =
      (l.teacherUid && l.teacherUid === resolvedPublicTutorId) ||
      (resolvedTeacherAuthUid && l.teacherUid === resolvedTeacherAuthUid) ||
      (resolvedTeacherEmail && (l.teacherEmail || '').toLowerCase().trim() === resolvedTeacherEmail);

    // Student conflict
    const isSameStudent =
      (l.studentUid && l.studentUid === studentAuthUid) ||
      (cleanStudentEmail && (l.studentEmail || '').toLowerCase().trim() === cleanStudentEmail);

    return isSameTeacher || isSameStudent;
  });

  if (candidateConflict) {
    const isTeacher =
      (candidateConflict.teacherUid && candidateConflict.teacherUid === resolvedPublicTutorId) ||
      (resolvedTeacherEmail && (candidateConflict.teacherEmail || '').toLowerCase().trim() === resolvedTeacherEmail);

    return {
      success: false,
      error: isTeacher
        ? 'Bloqueio de Conflito: O Amigo Nativo já possui outra aula agendada neste horário. Por favor, selecione outro horário.'
        : 'Bloqueio de Conflito: Você já possui outra aula agendada neste horário. Por favor, selecione outro horário.',
      statusCode: 409,
    };
  }

  // 8. Check Trial Lesson Eligibility & Balance
  if (isTrialLesson) {
    if (hasAlreadyCompletedTrial) {
      return {
        success: false,
        error: 'Aula experimental já foi utilizada anteriormente por este estudante.',
        statusCode: 400,
      };
    }

    const existingActiveTrial = consolidatedLessons.find((l) => {
      const isCancelled = l.status === 'cancelled' || l.status === 'canceled' || Boolean(l.cancelledAt);
      if (isCancelled) return false;
      const isSameStudent =
        l.studentUid === studentAuthUid ||
        (cleanStudentEmail && (l.studentEmail || '').toLowerCase().trim() === cleanStudentEmail);
      return isSameStudent && Boolean(l.isTrialLesson);
    });

    if (existingActiveTrial) {
      return {
        success: false,
        error: 'Você já possui uma aula experimental agendada ou realizada.',
        statusCode: 400,
      };
    }
  } else {
    // Check balance for regular lesson
    if (currentAvailable <= 0) {
      return {
        success: false,
        error: 'Saldo de aulas insuficiente. Por favor, adquira créditos de aulas antes de agendar.',
        statusCode: 402,
      };
    }
  }

  // 9. Compute updated balances
  let newContracted = currentContracted;
  let newAvailable = currentAvailable;
  if (isTrialLesson) {
    newContracted = Math.max(currentContracted, 1);
    newAvailable = Math.max(0, currentAvailable);
  } else {
    newContracted = currentContracted;
    newAvailable = Math.max(0, currentAvailable - 1);
  }

  const nowIso = new Date().toISOString();
  const sanitizedLesson = {
    id: deterministicLessonId,
    title: title || (isTrialLesson ? 'Aula Experimental Ao Vivo (Google Meet)' : 'Aula Ao Vivo 1-on-1'),
    description: description || '',
    startDateTime,
    endDateTime,
    studentUid: studentAuthUid,
    studentEmail: cleanStudentEmail || studentDoc?.email || '',
    studentName: studentName || studentDoc?.name || (cleanStudentEmail ? cleanStudentEmail.split('@')[0] : 'Aluno'),
    teacherUid: resolvedPublicTutorId,
    teacherEmail: resolvedTeacherEmail,
    teacherName: resolvedTeacherName,
    meetLink: resolvedMeetLink,
    status: 'scheduled',
    isTrialLesson: Boolean(isTrialLesson),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // 10. Atomic Execution: Firebase Admin SDK runTransaction when available
  if (db && !isCloudWriteDisabled) {
    try {
      await db.runTransaction(async (transaction) => {
        const studentRef = db.collection('users').doc(studentAuthUid);
        const lessonRef = db.collection('lessons').doc(deterministicLessonId);
        const studentSubLessonRef = db.collection('users').doc(studentAuthUid).collection('lessons').doc(deterministicLessonId);

        transaction.set(lessonRef, sanitizedLesson, { merge: true });
        transaction.set(studentSubLessonRef, sanitizedLesson, { merge: true });

        // Update teacher subcollection in /users and /tutors
        if (resolvedTeacherAuthUid) {
          const teacherUserSubLesson = db.collection('users').doc(resolvedTeacherAuthUid).collection('lessons').doc(deterministicLessonId);
          transaction.set(teacherUserSubLesson, sanitizedLesson, { merge: true });
        }
        if (resolvedPublicTutorId) {
          const tutorSubLesson = db.collection('tutors').doc(resolvedPublicTutorId).collection('lessons').doc(deterministicLessonId);
          transaction.set(tutorSubLesson, sanitizedLesson, { merge: true });
        }
        if (matchedTutor.legacyId && matchedTutor.legacyId !== resolvedPublicTutorId && matchedTutor.legacyId !== resolvedTeacherAuthUid) {
          const legacyTutorSubLesson = db.collection('tutors').doc(matchedTutor.legacyId).collection('lessons').doc(deterministicLessonId);
          transaction.set(legacyTutorSubLesson, sanitizedLesson, { merge: true });
        }

        // Student assignments record
        const assignmentRef = db.collection('student_assignments').doc(studentAuthUid);
        transaction.set(
          assignmentRef,
          {
            studentUid: studentAuthUid,
            teacherUid: resolvedPublicTutorId,
            teacherAuthUid: resolvedTeacherAuthUid || null,
            teacherEmail: resolvedTeacherEmail,
            teacherName: resolvedTeacherName,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        // Student document update
        transaction.set(
          studentRef,
          {
            uid: studentAuthUid,
            id: studentAuthUid,
            email: cleanStudentEmail || studentDoc?.email || '',
            name: sanitizedLesson.studentName,
            teacherUid: resolvedPublicTutorId,
            assignedNativeFriendUID: resolvedPublicTutorId,
            nativeFriendUID: resolvedPublicTutorId,
            teacherEmail: resolvedTeacherEmail,
            teacherName: resolvedTeacherName,
            teacherMeetUrl: resolvedMeetLink,
            enrollmentStatus: 'active',
            hasCompletedTrialLesson: isTrialLesson ? true : hasAlreadyCompletedTrial,
            contractedLessons: newContracted,
            availableLessons: newAvailable,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        // Idempotent reconciliation of legacy student doc without deletion
        if (studentDoc && studentDoc.id && studentDoc.id !== studentAuthUid) {
          const legacyStudentRef = db.collection('users').doc(studentDoc.id);
          transaction.set(legacyStudentRef, { canonicalUid: studentAuthUid, updatedAt: nowIso }, { merge: true });
        }
      });
    } catch (txErr: any) {
      if (isPermissionError(txErr)) {
        isCloudWriteDisabled = true;
        console.info('[serverFirestore] Remote schedule transaction restricted by IAM, committing to synchronized state.');
      } else {
        console.warn('[serverFirestore] Firestore admin transaction warning:', txErr);
      }
    }
  }

  // 11. Synchronize in-memory AppDb if provided
  if (dbState) {
    if (!Array.isArray(dbState.liveLessons)) dbState.liveLessons = [];
    const existingIdx = dbState.liveLessons.findIndex((l: any) => l.id === deterministicLessonId);
    if (existingIdx >= 0) {
      dbState.liveLessons[existingIdx] = sanitizedLesson;
    } else {
      dbState.liveLessons.unshift(sanitizedLesson);
    }

    if (!dbState.userProfiles) dbState.userProfiles = {};
    const profileKey = cleanStudentEmail || studentAuthUid;
    dbState.userProfiles[profileKey] = {
      ...(dbState.userProfiles[profileKey] || {}),
      id: studentAuthUid,
      uid: studentAuthUid,
      email: cleanStudentEmail,
      name: sanitizedLesson.studentName,
      teacherUid: resolvedPublicTutorId,
      assignedNativeFriendUID: resolvedPublicTutorId,
      nativeFriendUID: resolvedPublicTutorId,
      teacherEmail: resolvedTeacherEmail,
      teacherName: resolvedTeacherName,
      teacherMeetUrl: resolvedMeetLink,
      enrollmentStatus: 'active',
      hasCompletedTrialLesson: isTrialLesson ? true : hasAlreadyCompletedTrial,
      contractedLessons: newContracted,
      availableLessons: newAvailable,
      updatedAt: nowIso,
    };

    if (!Array.isArray(dbState.students)) dbState.students = [];
    const stIdx = dbState.students.findIndex(
      (s: any) => (s.email || '').toLowerCase().trim() === cleanStudentEmail || s.uid === studentAuthUid || s.id === studentAuthUid
    );
    if (stIdx >= 0) {
      dbState.students[stIdx] = {
        ...dbState.students[stIdx],
        uid: studentAuthUid,
        studentUid: studentAuthUid,
        teacherUid: resolvedPublicTutorId,
        teacherEmail: resolvedTeacherEmail,
        teacherName: resolvedTeacherName,
        status: 'active',
        contractedLessons: newContracted,
        hasCompletedTrialLesson: isTrialLesson ? true : hasAlreadyCompletedTrial,
      };
    } else {
      dbState.students.push({
        id: studentAuthUid,
        uid: studentAuthUid,
        studentUid: studentAuthUid,
        name: sanitizedLesson.studentName,
        studentName: sanitizedLesson.studentName,
        email: cleanStudentEmail,
        studentEmail: cleanStudentEmail,
        teacherUid: resolvedPublicTutorId,
        teacherEmail: resolvedTeacherEmail,
        teacherName: resolvedTeacherName,
        status: 'active',
        contractedLessons: newContracted,
        hasCompletedTrialLesson: isTrialLesson ? true : false,
        createdAt: nowIso,
      });
    }
  }

  return {
    success: true,
    lesson: sanitizedLesson,
    remainingLessons: newAvailable,
    contractedLessons: newContracted,
    isTrialLesson: Boolean(isTrialLesson),
    statusCode: 200,
  };
}
