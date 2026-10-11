import 'dotenv/config';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Ensure required Firebase environment variables are loaded for staging
if (!process.env.FIREBASE_PROJECT_ID) {
  process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
}
if (!process.env.FIREBASE_DATABASE_ID) {
  process.env.FIREBASE_DATABASE_ID = '(default)';
}

// Check if running within tsx or already bootstrapped
const isTsx =
  process.execArgv.some((arg) => arg.includes('tsx')) ||
  process.env.TSX_BOOTSTRAPPED === '1' ||
  (process.argv[1] && process.argv[1].includes('tsx')) ||
  (process.argv[0] && process.argv[0].includes('tsx')) ||
  Boolean((process as any)[Symbol.for('tsx.jsx')]) ||
  Boolean((process as any)[Symbol.for('tsx.version')]);

if (!isTsx) {
  // Plain 'node server.ts' execution (e.g. Cloud Run production container).
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
  // Running under tsx loader: start full application server
  await import('./serverApp.ts');
}
