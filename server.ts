import 'dotenv/config';
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import appletConfig from './firebase-applet-config.json' with { type: 'json' };

const isPlaceholder = (val: string | undefined): boolean => {
  if (!val) return true;
  const trimmed = val.trim();
  return (
    trimmed === '' ||
    trimmed.startsWith('your-') ||
    trimmed.includes('placeholder') ||
    trimmed.includes('YOUR_') ||
    trimmed.includes('<') ||
    trimmed.includes('>')
  );
};

// Clean non-existent or placeholder credentials file to allow fallback to ADC
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    if (!fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS) || isPlaceholder(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
  } catch {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
}

// Ensure required Firebase environment variables are loaded for staging
if (isPlaceholder(process.env.FIREBASE_PROJECT_ID) && appletConfig?.projectId) {
  process.env.FIREBASE_PROJECT_ID = appletConfig.projectId;
}
if (!process.env.FIREBASE_PROJECT_ID) {
  process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
}
if (isPlaceholder(process.env.FIREBASE_DATABASE_ID) && appletConfig?.firestoreDatabaseId) {
  process.env.FIREBASE_DATABASE_ID = appletConfig.firestoreDatabaseId;
}
if (!process.env.FIREBASE_DATABASE_ID) {
  process.env.FIREBASE_DATABASE_ID = '(default)';
}

if (appletConfig) {
  if (isPlaceholder(process.env.VITE_FIREBASE_PROJECT_ID) && appletConfig.projectId) {
    process.env.VITE_FIREBASE_PROJECT_ID = appletConfig.projectId;
  }
  if (isPlaceholder(process.env.VITE_FIREBASE_API_KEY) && appletConfig.apiKey) {
    process.env.VITE_FIREBASE_API_KEY = appletConfig.apiKey;
  }
  if (isPlaceholder(process.env.VITE_FIREBASE_AUTH_DOMAIN) && appletConfig.authDomain) {
    process.env.VITE_FIREBASE_AUTH_DOMAIN = appletConfig.authDomain;
  }
  if (isPlaceholder(process.env.VITE_FIREBASE_STORAGE_BUCKET) && appletConfig.storageBucket) {
    process.env.VITE_FIREBASE_STORAGE_BUCKET = appletConfig.storageBucket;
  }
  if (isPlaceholder(process.env.VITE_FIREBASE_MESSAGING_SENDER_ID) && appletConfig.messagingSenderId) {
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID = appletConfig.messagingSenderId;
  }
  if (isPlaceholder(process.env.VITE_FIREBASE_APP_ID) && appletConfig.appId) {
    process.env.VITE_FIREBASE_APP_ID = appletConfig.appId;
  }
  if (isPlaceholder(process.env.VITE_FIREBASE_DATABASE_ID) && appletConfig.firestoreDatabaseId) {
    process.env.VITE_FIREBASE_DATABASE_ID = appletConfig.firestoreDatabaseId;
  }
}

/**
 * Detects whether the process was executed directly with tsx (e.g. node --import tsx server.ts,
 * tsx server.ts, or NODE_OPTIONS="--import tsx"), avoiding redundant child processes.
 */
export function isTsxEnvironment(): boolean {
  return (
    process.execArgv.some((arg) => arg.includes('tsx')) ||
    process.env.TSX_BOOTSTRAPPED === '1' ||
    Boolean(process.argv[1]?.includes('tsx')) ||
    Boolean(process.argv[0]?.includes('tsx')) ||
    Boolean(process.env.NODE_OPTIONS?.includes('tsx')) ||
    Boolean((process as any)[Symbol.for('tsx.jsx')]) ||
    Boolean((process as any)[Symbol.for('tsx.version')])
  );
}

const isTsx = isTsxEnvironment();

if (!isTsx) {
  // Plain 'node server.ts' execution without --import tsx (fallback for backwards compatibility).
  // Transparently bootstrap with the tsx module loader so that all TypeScript modules
  // and extensionless imports resolve without ERR_MODULE_NOT_FOUND.
  const currentFilePath = fileURLToPath(import.meta.url);

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', currentFilePath],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        TSX_BOOTSTRAPPED: '1',
      },
    }
  );

  const forwardSignal = (sig: NodeJS.Signals) => {
    try {
      if (child.pid) child.kill(sig);
    } catch {}
  };

  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGHUP', () => forwardSignal('SIGHUP'));

  child.on('exit', (code, signal) => {
    if (signal) {
      try {
        process.kill(process.pid, signal);
      } catch {}
    }
    process.exit(code ?? 0);
  });
} else {
  // Direct execution with tsx (--import tsx): NO child process spawned (PID 1 in Docker).
  // Start application server based on execution mode (prevent start when imported in test environment)
  if (process.env.NODE_ENV !== 'test') {
    if (process.env.DIAGNOSTIC_ONLY === 'true') {
      const { startDiagnosticServer } = await import('./src/diagnosticApp.ts');
      await startDiagnosticServer();
    } else {
      await import('./serverApp.ts');
    }
  }
}

