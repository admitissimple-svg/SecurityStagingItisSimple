import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseAuthSignOut,
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../firebase';

let inMemoryToken: string | null = null;
let inMemoryGoogleAccessToken: string | null = null;

export function getGoogleOAuthToken(): string | null {
  return inMemoryGoogleAccessToken;
}

export function setGoogleOAuthToken(token: string | null) {
  inMemoryGoogleAccessToken = token;
}

/**
 * YouTube OAuth authorization for adm.itissimple@gmail.com
 */
export async function requestYouTubeAuth(hintEmail = 'adm.itissimple@gmail.com'): Promise<string | null> {
  try {
    const provider = new GoogleAuthProvider();
    const customParams: Record<string, string> = { prompt: 'consent' };
    if (hintEmail && hintEmail.includes('@')) {
      customParams.login_hint = hintEmail.trim();
    }
    provider.setCustomParameters(customParams);
    provider.addScope('https://www.googleapis.com/auth/youtube.readonly');
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    provider.addScope('https://www.googleapis.com/auth/calendar.events');
    provider.addScope('https://www.googleapis.com/auth/gmail.send');

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken || null;
    if (accessToken) {
      setGoogleOAuthToken(accessToken);
    }
    return accessToken;
  } catch (err: any) {
    console.error('Failed to authenticate YouTube with OAuth:', err);
    throw err;
  }
}

/**
 * Teacher Google Drive OAuth authorization.
 * Authenticates the teacher with Google and requests the drive.file scope,
 * returning the active OAuth access token to manage files directly in their personal Google Drive.
 * Supports optional login_hint (e.g. estilobeeforkids@gmail.com) for seamless, conflict-free authorization.
 */
export async function requestGoogleDriveAuth(hintEmail?: string): Promise<string | null> {
  try {
    const provider = new GoogleAuthProvider();
    const customParams: Record<string, string> = { prompt: 'select_account' };
    if (hintEmail && hintEmail.includes('@')) {
      customParams.login_hint = hintEmail.trim();
    }
    provider.setCustomParameters(customParams);
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    provider.addScope('https://www.googleapis.com/auth/calendar.events');
    provider.addScope('https://www.googleapis.com/auth/gmail.send');
    provider.addScope('https://www.googleapis.com/auth/youtube.readonly');

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken || null;
    if (accessToken) {
      setGoogleOAuthToken(accessToken);
    }
    return accessToken;
  } catch (err: any) {
    console.error('Failed to authenticate Google Drive with OAuth:', err);
    throw err;
  }
}

/**
 * Resolves the authenticated Firebase User once auth state has completed initialization.
 * Returns null for unauthenticated visitors without hanging indefinitely.
 */
export async function waitForAuthUser(): Promise<User | null> {
  if (auth.currentUser) {
    return auth.currentUser;
  }
  if (typeof (auth as any)?.authStateReady === 'function') {
    try {
      await (auth as any).authStateReady();
    } catch {
      // Ignore auth readiness errors
    }
    if (auth.currentUser) {
      return auth.currentUser;
    }
  }
  return new Promise<User | null>((resolve) => {
    let unsub: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (unsub) unsub();
      resolve(auth.currentUser || null);
    }, 1200);

    unsub = onAuthStateChanged(auth, (user) => {
      clearTimeout(timer);
      if (unsub) unsub();
      resolve(user || null);
    });
  });
}

export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  const user = await waitForAuthUser();
  if (user) {
    try {
      inMemoryToken = await user.getIdToken(forceRefresh);
    } catch {
      try {
        inMemoryToken = await user.getIdToken(true);
      } catch {
        // Fallback to cached inMemoryToken
      }
    }
  } else {
    inMemoryToken = null;
  }
  return inMemoryToken;
}

/**
 * Safely decodes JWT claims from a Firebase ID Token without external dependencies.
 */
function parseJwtClaims(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Resolves a verified Firebase ID Token with administrator permissions.
 * If the current token lacks custom claim role='admin', it invokes the backend
 * sync endpoint and refreshes the token to receive the server-minted claim.
 */
export async function getAdminAccessToken(): Promise<string | null> {
  const user = await waitForAuthUser();
  if (!user) {
    return null;
  }

  let token = await user.getIdToken();
  const claims = parseJwtClaims(token);

  if (claims?.role !== 'admin') {
    try {
      const res = await fetch('/api/auth/sync-admin-claims', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        token = await user.getIdToken(true);
      }
    } catch (err) {
      console.warn('[auth] Notice during admin claims sync:', err);
    }
  }

  inMemoryToken = token;
  return token;
}

export interface RealAuthResult {
  accessToken: string;
  googleOAuthAccessToken?: string | null;
  user: {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
  };
}

/**
 * Real Google Authentication using Firebase Auth Popup
 */
export async function googleSignIn(): Promise<RealAuthResult> {
  const result = await signInWithPopup(auth, googleAuthProvider);
  const user: User = result.user;
  const token = await user.getIdToken();
  inMemoryToken = token;

  const credential = GoogleAuthProvider.credentialFromResult(result);
  const googleOAuthAccessToken = credential?.accessToken || null;
  if (googleOAuthAccessToken) {
    setGoogleOAuthToken(googleOAuthAccessToken);
  }

  return {
    accessToken: token,
    googleOAuthAccessToken,
    user: {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    },
  };
}

/**
 * Real Firebase Email/Password Sign-In
 */
export async function firebaseSignInWithEmail(email: string, pass: string): Promise<RealAuthResult> {
  const result = await signInWithEmailAndPassword(auth, email, pass);
  const user = result.user;
  const token = await user.getIdToken();
  inMemoryToken = token;

  return {
    accessToken: token,
    user: {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    },
  };
}

/**
 * Real Firebase Email/Password Account Creation
 */
export async function firebaseSignUpWithEmail(email: string, pass: string): Promise<RealAuthResult> {
  const result = await createUserWithEmailAndPassword(auth, email, pass);
  const user = result.user;
  const token = await user.getIdToken();
  inMemoryToken = token;

  return {
    accessToken: token,
    user: {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    },
  };
}

/**
 * Real Sign Out
 */
export async function firebaseSignOut(): Promise<void> {
  inMemoryToken = null;
  await firebaseAuthSignOut(auth).catch(() => null);
}

