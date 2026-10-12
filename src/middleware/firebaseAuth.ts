import { Request, Response, NextFunction } from 'express';
import { getFirebaseAdminAuth } from '../serverFirebaseAdmin';

/**
 * Accepted coarse-grained roles within the trusted role authorization model.
 */
export type UserRole = 'admin' | 'teacher' | 'student';

/**
 * Verified Firebase Identity attached to the request by authentication middleware.
 * Only verified server-side claims are populated; untrusted client parameters are ignored.
 */
export interface AuthenticatedUser {
  uid: string;
  email?: string;
  email_verified: boolean;
  role: UserRole;
}

// Extend Express Request interface with type-safe verified identity
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Strongly typed interface for Express handlers requiring an authenticated user.
 */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * Extracts a trusted role strictly from the verified Firebase ID token claims.
 *
 * Rules:
 * 1. If decoded token contains role === 'admin' -> 'admin'
 * 2. If decoded token contains role === 'teacher' -> 'teacher'
 * 3. Any unexpected, malicious, or missing claim defaults safely to 'student'
 *
 * Never derives authorization from req.body, req.query, req.params, email,
 * localStorage, Firestore profile role, or client-supplied account objects.
 */
export function extractTrustedRole(
  decodedToken?: Record<string, unknown> | null
): UserRole {
  if (!decodedToken || typeof decodedToken !== 'object') {
    return 'student';
  }

  const rawRole = (decodedToken as { role?: unknown; admin?: unknown }).role;
  if (rawRole === 'admin' || (decodedToken as { admin?: unknown }).admin === true) {
    return 'admin';
  }
  if (rawRole === 'teacher' || (decodedToken as { teacher?: unknown }).teacher === true) {
    return 'teacher';
  }

  // Safety fallback: unknown, missing, or unverified claims default safely to 'student'.
  // Administrative authority CANNOT be obtained merely by declaring an email present in a list;
  // it requires an authorized mechanism (cryptographically verified custom claims from Firebase Admin SDK).
  return 'student';
}

const verifiedUserSet = new WeakSet<object>();

/**
 * Marks an AuthenticatedUser object as having proven verified origin from Firebase Admin SDK.
 */
export function markAsVerifiedUser(user: AuthenticatedUser): AuthenticatedUser {
  if (user && typeof user === 'object') {
    verifiedUserSet.add(user);
  }
  return user;
}

/**
 * Validates whether an identity object has proven server-verified origin.
 * Does not trust arbitrary objects attached to req.user by untrusted sources or request tampering.
 */
export function isVerifiedUser(user: unknown): user is AuthenticatedUser {
  if (!user || typeof user !== 'object') return false;
  if (!verifiedUserSet.has(user as object)) return false;
  const u = user as AuthenticatedUser;
  return (
    typeof u.uid === 'string' &&
    u.uid.length > 0 &&
    (u.role === 'admin' || u.role === 'teacher' || u.role === 'student')
  );
}

/**
 * Dedicated Express authentication middleware that verifies Firebase ID tokens.
 *
 * Requirements:
 * 1. Reads 'Authorization: Bearer <Firebase_ID_TOKEN>'
 * 2. Rejects requests with missing, malformed, invalid, or expired tokens.
 * 3. Verifies token via Firebase Admin Auth verifyIdToken().
 * 4. Attaches ONLY verified identity information (uid, email, email_verified, role).
 * Never trusts role or UID provided in body or query params.
 */
export const firebaseAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing Authorization header',
    });
    return;
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Malformed Authorization header. Format must be: Bearer <token>',
    });
    return;
  }

  const idToken = parts[1];

  try {
    const adminAuth = getFirebaseAdminAuth();
    const decodedToken = await adminAuth.verifyIdToken(idToken);

    // Extract trusted role strictly from verified token claims
    const role = extractTrustedRole(decodedToken);

    // Attach ONLY verified identity information from server-verified token with trusted provenance
    const user: AuthenticatedUser = markAsVerifiedUser({
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: Boolean(decodedToken.email_verified),
      role,
    });
    req.user = user;

    next();
  } catch (err: unknown) {
    const errorCode = (err as { code?: string })?.code;

    if (errorCode === 'auth/id-token-expired') {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Firebase ID token has expired',
      });
      return;
    }

    if (errorCode === 'auth/id-token-revoked') {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Firebase ID token has been revoked',
      });
      return;
    }

    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid Firebase ID token',
    });
    return;
  }
};

/**
 * Ensures that an authenticated user identity exists on the request with proven origin.
 * Returns 401 if unauthenticated.
 */
export const requireAuthenticatedUser = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || !req.user.uid || !isVerifiedUser(req.user)) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing',
    });
    return;
  }
  next();
};

/**
 * Ensures that the authenticated user possesses the 'admin' role with proven origin.
 * Requires verified req.user.role === 'admin'.
 * Returns 401 if unauthenticated, 403 if unauthorized.
 */
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || !req.user.uid || !isVerifiedUser(req.user)) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing',
    });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: administrator privileges required',
    });
    return;
  }

  next();
};

/**
 * Ensures that the authenticated user possesses either 'teacher' or 'admin' role with proven origin.
 * Returns 401 if unauthenticated, 403 if unauthorized.
 */
export const requireTeacher = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || !req.user.uid || !isVerifiedUser(req.user)) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing',
    });
    return;
  }

  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: teacher or administrator privileges required',
    });
    return;
  }

  next();
};

/**
 * Ensures that any verified authenticated user is permitted.
 * Since every valid authenticated user defaults to at least 'student',
 * any verified user is accepted.
 * Returns 401 if unauthenticated.
 */
export const requireStudent = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || !req.user.uid || !isVerifiedUser(req.user)) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing',
    });
    return;
  }

  next();
};

/**
 * Safely extracts and verifies the Firebase ID token from the request if provided.
 * Defense-in-depth:
 * 1. Checks if req.user has proven verified origin from our auth layer.
 * 2. Never trusts arbitrary unverified objects attached to req.user.
 * 3. Extracts and verifies token via Firebase Admin Auth verifyIdToken() from Authorization header.
 * Returns the AuthenticatedUser object if valid, or null if unauthenticated / invalid / missing.
 * Does NOT throw or terminate the request (ideal for optional-auth endpoints like GET /api/tutors).
 */
export async function getVerifiedUserFromRequest(req: Request): Promise<AuthenticatedUser | null> {
  // Defense in depth: only trust req.user if it was stamped as verified by our auth layer
  if (req.user && isVerifiedUser(req.user)) {
    return req.user;
  }

  // Untrusted req.user or unverified state is discarded; verify directly from authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
    return null;
  }

  const idToken = parts[1];
  try {
    const adminAuth = getFirebaseAdminAuth();
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const role = extractTrustedRole(decodedToken);
    const user: AuthenticatedUser = markAsVerifiedUser({
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: Boolean(decodedToken.email_verified),
      role,
    });
    req.user = user;
    return user;
  } catch {
    return null;
  }
}

/**
 * Safely checks if a request has a valid Firebase ID token with custom claim role === 'admin'.
 * Returns true only if verified by Firebase Admin SDK.
 * Returns false on any failure, unauthenticated request, or non-admin role.
 */
export async function isVerifiedAdminRequest(req: Request): Promise<boolean> {
  const user = await getVerifiedUserFromRequest(req);
  return user?.role === 'admin';
}


