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
/**
 * Resolves and validates a numeric server port from environment variables.
 * Enforces valid TCP port range (1-65535). Fallbacks safely to defaultPort (3000).
 * Accurately supports Cloud Run dynamic port 8080 and any custom valid port.
 */
export function parsePort(val?: string | number): number | null {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  if (!/^\d+$/.test(str)) return null;
  const parsed = parseInt(str, 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  return null;
}

export function parseCliPort(): number | null {
  const args = process.argv || [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      const p = parsePort(args[i + 1]);
      if (p) return p;
    }
    if (args[i].startsWith('--port=')) {
      const p = parsePort(args[i].split('=')[1]);
      if (p) return p;
    }
  }
  return null;
}

export function resolvePort(portEnv?: string | number, appPortEnv?: string | number, defaultPort = 3000): number {
  return parsePort(portEnv) ?? parsePort(appPortEnv) ?? defaultPort;
}

export function resolveEffectiveDiagnosticPort(): number {
  const cliPort = parseCliPort();
  if (cliPort) return cliPort;

  const appPort = parsePort(process.env.APP_PORT);
  if (appPort) return appPort;

  const rawPort = parsePort(process.env.PORT);
  if (rawPort && rawPort !== 8080) {
    return rawPort;
  }
  return 3000;
}

export const PORT = resolveEffectiveDiagnosticPort();

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
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Authorization, X-Serverless-Authorization, X-Diagnostic-Authorization, X-App-Authorization');
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
