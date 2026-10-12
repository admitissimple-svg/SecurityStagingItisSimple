import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

import {
  isAuthorizedOriginStrict,
  registerDiagnosticRoutes,
  isDiagnosticMode,
  DIAGNOSTIC_PROJECT_ID,
  DIAGNOSTIC_DATABASE_ID,
} from './serverDiagnostic';

// Ensure staging environment variables are strictly bound
if (!process.env.FIREBASE_PROJECT_ID) {
  process.env.FIREBASE_PROJECT_ID = DIAGNOSTIC_PROJECT_ID;
}
if (!process.env.FIREBASE_DATABASE_ID) {
  process.env.FIREBASE_DATABASE_ID = DIAGNOSTIC_DATABASE_ID;
}

const app = express();
export const PORT = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : (process.env.APP_PORT ? parseInt(process.env.APP_PORT, 10) : 8080);

// Strict CORS middleware for diagnostic staging backend
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    if (isAuthorizedOriginStrict(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      // Credentials enabled only for verified staging allowlist
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      if (req.method === 'OPTIONS') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'CORS policy: origin unauthorized',
          origin,
        });
      }
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Authorization, X-Serverless-Authorization');
  res.setHeader('Access-Control-Max-Age', '3600');

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

// Register exclusively health and diagnostic probe endpoints
registerDiagnosticRoutes(app);

// Root route describing dedicated diagnostic backend state
app.get('/', (_req, res) => {
  res.json({
    service: "It's Simple Dedicated Diagnostic Backend",
    mode: 'DIAGNOSTIC_ONLY',
    status: 'online',
    projectId: process.env.FIREBASE_PROJECT_ID || DIAGNOSTIC_PROJECT_ID,
    databaseId: process.env.FIREBASE_DATABASE_ID || DIAGNOSTIC_DATABASE_ID,
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

// Explicit rejection for all business and unknown API endpoints
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Backend is operating in DIAGNOSTIC_ONLY mode. Business routes, authentication, student/tutor management, and payments are strictly not registered.',
    requestedPath: req.originalUrl,
    diagnosticMode: true,
  });
});

// Catch-all for any other routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Backend is operating in DIAGNOSTIC_ONLY mode. Static frontend assets are disabled.',
    requestedPath: req.originalUrl,
    diagnosticMode: true,
  });
});

let activeDiagnosticServer: any = null;

export async function startDiagnosticServer() {
  if (activeDiagnosticServer) {
    return activeDiagnosticServer;
  }

  console.log('========================================================================');
  console.log('[Diagnostic] Starting Dedicated Isolated Diagnostic Backend');
  console.log(`[Diagnostic] Project: ${process.env.FIREBASE_PROJECT_ID || DIAGNOSTIC_PROJECT_ID}`);
  console.log(`[Diagnostic] Database: ${process.env.FIREBASE_DATABASE_ID || DIAGNOSTIC_DATABASE_ID}`);
  console.log(`[Diagnostic] Port: ${PORT}`);
  console.log('[Diagnostic] Authentication: Native Google Cloud IAM (Bearer OIDC ID Token)');
  console.log('[Diagnostic] Business routes: DISABLED (Not registered)');
  console.log('[Diagnostic] Local app_db.json: DISABLED (Not loaded, no writes)');
  console.log('[Diagnostic] Cloud sync intervals: DISABLED');
  console.log('========================================================================');

  activeDiagnosticServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Diagnostic] Diagnostic Backend listening on http://0.0.0.0:${PORT}`);
  });

  activeDiagnosticServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Diagnostic] Port ${PORT} is already in use.`);
    } else {
      console.error('[Diagnostic] Server error event:', err);
    }
  });

  return activeDiagnosticServer;
}

export { app };

// Auto-start only if directly executed from command line (e.g. tsx src/diagnosticApp.ts)
const isDirectExecution =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('diagnosticApp.ts') || process.argv[1].endsWith('diagnosticApp.js'));

if (isDirectExecution && process.env.NODE_ENV !== 'test' && isDiagnosticMode()) {
  startDiagnosticServer();
}
