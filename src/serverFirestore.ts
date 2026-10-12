import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp, ALLOWED_STAGING_PROJECT_ID } from './serverFirebaseAdmin';

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
    const targetDatabaseId = process.env.FIREBASE_DATABASE_ID?.trim() || '(default)';
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
export async function saveTutorToFirestore(tutor: any): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || !tutor) return false;
  try {
    const cleanEmail = (tutor.email || '').toLowerCase().trim();
    const tutorId = tutor.id || `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
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

    if (cleanEmailDocId && cleanEmailDocId !== tutorId) {
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

/**
 * Fetch all Native Friend / Teacher profiles directly from unified /users collection (role == 'teacher')
 * with fallback to legacy /tutors collection.
 */
export async function fetchTutorsFromFirestore(): Promise<any[]> {
  const db = getFirestoreDb();
  if (!db) return [];
  try {
    const fetchPromise = async () => {
      const listMap = new Map<string, any>();

      try {
        const [usersSnap, legacySnap] = await Promise.all([
          db.collection('users').where('role', '==', 'teacher').get().catch(() => null),
          db.collection('tutors').get().catch(() => null),
        ]);

        if (usersSnap) {
          usersSnap.forEach((d) => {
            const data = d.data();
            if (data && (data.email || data.name)) {
              const key = (data.email || d.id).toLowerCase().trim();
              const existing = listMap.get(key) || {};
              const isApproved =
                data.approvalStatus === 'approved' ||
                data.isApproved === true ||
                data.status === 'approved' ||
                data.approved === true ||
                existing.isApproved;
              listMap.set(key, {
                ...existing,
                id: d.id,
                ...data,
                role: 'teacher',
                ...(isApproved ? { approvalStatus: 'approved', isApproved: true, status: 'approved', approved: true } : {}),
              });
            }
          });
        }

        if (legacySnap) {
          legacySnap.forEach((d) => {
            const data = d.data();
            if (data && (data.email || data.name)) {
              const key = (data.email || d.id).toLowerCase().trim();
              const existing = listMap.get(key) || {};
              const isApproved =
                data.approvalStatus === 'approved' ||
                data.isApproved === true ||
                data.status === 'approved' ||
                data.approved === true ||
                existing.isApproved;
              const merged = { ...data, ...existing, id: existing.id || d.id, role: 'teacher' };
              if (isApproved) {
                merged.approvalStatus = 'approved';
                merged.isApproved = true;
                merged.status = 'approved';
                merged.approved = true;
              }
              listMap.set(key, merged);
            }
          });
        }
      } catch (dbErr) {
        console.warn('Error reading tutors from Firestore database:', dbErr);
      }

      const results = Array.from(listMap.values());
      const approvedIds = results
        .filter((t) => t.approvalStatus === 'approved' || t.isApproved === true)
        .map((t) => t.id || t.email);
      console.log('[NativeFriends Server] Retrieved Firestore tutor IDs:', approvedIds);
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

      // Merge tutors from /tutors collection with tutors from app_state/tutors so NO tutor is EVER lost
      const tutorMap = new Map<string, any>();
      const stateTutors = Array.isArray(tutors?.tutorsList) ? tutors.tutorsList : [];
      stateTutors.forEach((t: any) => {
        const key = (t.email || t.id || '').toLowerCase().trim();
        if (key) tutorMap.set(key, t);
      });
      (directTutors || []).forEach((t: any) => {
        const key = (t.email || t.id || '').toLowerCase().trim();
        if (key) {
          const existing = tutorMap.get(key) || {};
          const isExistingApproved = existing.approvalStatus === 'approved' || existing.isApproved === true || existing.status === 'approved';
          const isDirectApproved = t.approvalStatus === 'approved' || t.isApproved === true || t.status === 'approved';
          const merged = { ...existing, ...t };
          if (isExistingApproved || isDirectApproved) {
            merged.approvalStatus = 'approved';
            merged.isApproved = true;
            merged.status = 'approved';
          }
          tutorMap.set(key, merged);
        }
      });

      const consolidatedTutorsList = Array.from(tutorMap.values());
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
export async function fetchTutorDocumentFromFirestore(docId: string, timeoutMs: number = 500): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !docId) return null;
  try {
    const snap = await withTimeout(db.collection('tutors').doc(docId).get(), timeoutMs);
    return snap && snap.exists ? snap.data() : null;
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

/**
 * Server-side persistent storage of student vocabulary in Cloud Firestore.
 */
export async function saveStudentVocabularyToFirestoreServer(
  studentUid: string,
  entries: any[],
  studentEmail?: string
): Promise<boolean> {
  if (isCloudWriteDisabled) return false;
  const db = getFirestoreDb();
  if (!db || (!studentUid && !studentEmail)) return false;
  if (!entries || entries.length === 0) return true;

  try {
    const cleanUid = studentUid || (studentEmail ? studentEmail.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_') : '');
    const cleanEmail = (studentEmail || '').toLowerCase().trim();
    const emailDocId = cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_') : '';
    const hyphenDocId = cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9]/g, '-') : '';

    const targetDocIds = Array.from(new Set([cleanUid, emailDocId, hyphenDocId].filter(Boolean)));
    const sanitizedEntries = JSON.parse(JSON.stringify(entries || []));

    for (const docId of targetDocIds) {
      let existingList: any[] = [];
      try {
        const userSnap = await db.collection('users').doc(docId).get();
        if (userSnap.exists && Array.isArray(userSnap.data()?.vocabulary)) {
          existingList = userSnap.data()?.vocabulary;
        }
      } catch {}

      const map = new Map<string, any>();
      existingList.forEach((e) => {
        if (e && e.word) map.set(e.word.toLowerCase().trim(), e);
      });
      sanitizedEntries.forEach((e: any) => {
        if (e && e.word) {
          const key = e.word.toLowerCase().trim();
          map.set(key, { ...(map.get(key) || {}), ...e });
        }
      });
      const accumulated = Array.from(map.values()).sort((a, b) => (a.word || '').localeCompare(b.word || ''));

      await db.collection('users').doc(docId).set({ vocabulary: accumulated, updatedAt: new Date().toISOString() }, { merge: true });

      for (const item of sanitizedEntries) {
        if (item && item.word) {
          const wordDocId = (item.id || item.word).toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_');
          await db.collection('users').doc(docId).collection('vocabulary').doc(wordDocId).set(
            { ...item, studentUid: cleanUid, studentEmail: cleanEmail, updatedAt: new Date().toISOString() },
            { merge: true }
          );
        }
      }
    }
    return true;
  } catch (err: any) {
    if (isPermissionError(err)) {
      isCloudWriteDisabled = true;
      console.info('[serverFirestore] Remote vocabulary save restricted by IAM, continuing with local state.');
    } else {
      console.warn('Firestore server vocabulary save notice:', err);
    }
    return false;
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
