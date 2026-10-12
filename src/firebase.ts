import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, initializeAuth, inMemoryPersistence, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, initializeFirestore, memoryLocalCache, setLogLevel, Firestore } from 'firebase/firestore';

// Silence internal gRPC stream disconnection logs
try {
  setLogLevel('silent');
} catch {}

import appletConfig from '../firebase-applet-config.json';

// Helper para obter variáveis de ambiente estritamente do frontend (Vite/runtime) com fallback seguro para firebase-applet-config.json
const resolveClientEnv = (viteVal: string | undefined, envKey: string, fallbackKey?: keyof typeof appletConfig): string => {
  if (viteVal && typeof viteVal === 'string' && viteVal.trim().length > 0) {
    return viteVal.trim();
  }
  if (typeof process !== 'undefined' && process.env?.[envKey]) {
    return String(process.env[envKey]).trim();
  }
  if (fallbackKey && appletConfig && (appletConfig as any)[fallbackKey]) {
    return String((appletConfig as any)[fallbackKey]).trim();
  }
  return '';
};

// Obtenção exclusiva a partir das variáveis de ambiente frontend
export const ACTIVE_FIREBASE_API_KEY = resolveClientEnv(
  typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_FIREBASE_API_KEY : undefined,
  'VITE_FIREBASE_API_KEY',
  'apiKey'
);

export const ACTIVE_FIREBASE_AUTH_DOMAIN = resolveClientEnv(
  typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN : undefined,
  'VITE_FIREBASE_AUTH_DOMAIN',
  'authDomain'
);

export const ACTIVE_FIREBASE_PROJECT_ID = resolveClientEnv(
  typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID : undefined,
  'VITE_FIREBASE_PROJECT_ID',
  'projectId'
);

export const ACTIVE_FIREBASE_STORAGE_BUCKET = resolveClientEnv(
  typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET : undefined,
  'VITE_FIREBASE_STORAGE_BUCKET',
  'storageBucket'
);

export const ACTIVE_PROJECT_NUMBER = resolveClientEnv(
  typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID : undefined,
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'messagingSenderId'
);
export const ACTIVE_FIREBASE_MESSAGING_SENDER_ID = ACTIVE_PROJECT_NUMBER;

export const ACTIVE_FIREBASE_APP_ID = resolveClientEnv(
  typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_FIREBASE_APP_ID : undefined,
  'VITE_FIREBASE_APP_ID',
  'appId'
);
export const ACTIVE_APP_ID = ACTIVE_FIREBASE_APP_ID;

export const ACTIVE_OAUTH_CLIENT_ID = resolveClientEnv(
  typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_FIREBASE_OAUTH_CLIENT_ID : undefined,
  'VITE_FIREBASE_OAUTH_CLIENT_ID',
  'oAuthClientId'
);

// Utilização do banco Firestore configurado com fallback seguro
export const ACTIVE_FIREBASE_DATABASE_ID =
  resolveClientEnv(
    typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_FIREBASE_DATABASE_ID : undefined,
    'VITE_FIREBASE_DATABASE_ID',
    'firestoreDatabaseId'
  ) || (appletConfig as any)?.firestoreDatabaseId || '(default)';
export const ACTIVE_FIRESTORE_DATABASE_ID = ACTIVE_FIREBASE_DATABASE_ID;

// Validação estrita das configurações obrigatórias na inicialização
function validateFirebaseConfig(): void {
  const missing: string[] = [];
  if (!ACTIVE_FIREBASE_API_KEY) missing.push('VITE_FIREBASE_API_KEY');
  if (!ACTIVE_FIREBASE_AUTH_DOMAIN) missing.push('VITE_FIREBASE_AUTH_DOMAIN');
  if (!ACTIVE_FIREBASE_PROJECT_ID) missing.push('VITE_FIREBASE_PROJECT_ID');
  if (!ACTIVE_FIREBASE_STORAGE_BUCKET) missing.push('VITE_FIREBASE_STORAGE_BUCKET');
  if (!ACTIVE_PROJECT_NUMBER) missing.push('VITE_FIREBASE_MESSAGING_SENDER_ID');
  if (!ACTIVE_FIREBASE_APP_ID) missing.push('VITE_FIREBASE_APP_ID');

  const inconsistencies: string[] = [];

  if (ACTIVE_FIREBASE_PROJECT_ID && !/^[a-z0-9-]+$/.test(ACTIVE_FIREBASE_PROJECT_ID)) {
    inconsistencies.push(
      `VITE_FIREBASE_PROJECT_ID inválido ("${ACTIVE_FIREBASE_PROJECT_ID}"): identificadores de projeto devem conter apenas letras minúsculas, números e hífens.`
    );
  }

  if (
    ACTIVE_FIREBASE_PROJECT_ID &&
    ACTIVE_FIREBASE_AUTH_DOMAIN &&
    !ACTIVE_FIREBASE_AUTH_DOMAIN.includes(ACTIVE_FIREBASE_PROJECT_ID) &&
    !ACTIVE_FIREBASE_AUTH_DOMAIN.endsWith('.firebaseapp.com')
  ) {
    inconsistencies.push(
      `VITE_FIREBASE_AUTH_DOMAIN ("${ACTIVE_FIREBASE_AUTH_DOMAIN}") inconsistente com VITE_FIREBASE_PROJECT_ID ("${ACTIVE_FIREBASE_PROJECT_ID}").`
    );
  }

  if (
    ACTIVE_FIREBASE_PROJECT_ID &&
    ACTIVE_FIREBASE_STORAGE_BUCKET &&
    !ACTIVE_FIREBASE_STORAGE_BUCKET.includes(ACTIVE_FIREBASE_PROJECT_ID)
  ) {
    inconsistencies.push(
      `VITE_FIREBASE_STORAGE_BUCKET ("${ACTIVE_FIREBASE_STORAGE_BUCKET}") inconsistente com VITE_FIREBASE_PROJECT_ID ("${ACTIVE_FIREBASE_PROJECT_ID}").`
    );
  }

  if (ACTIVE_PROJECT_NUMBER && !/^\d+$/.test(ACTIVE_PROJECT_NUMBER)) {
    inconsistencies.push(
      `VITE_FIREBASE_MESSAGING_SENDER_ID inválido ("${ACTIVE_PROJECT_NUMBER}"): deve conter apenas dígitos numéricos.`
    );
  }

  if (missing.length > 0 || inconsistencies.length > 0) {
    const errorLines = [
      '================================================================================',
      '[FIREBASE CONFIG ERROR] Falha na validação de inicialização do Firebase Frontend',
      '================================================================================',
    ];

    if (missing.length > 0) {
      errorLines.push('Variáveis de ambiente obrigatórias ausentes ou vazias:');
      missing.forEach((v) => errorLines.push(`  - ${v}`));
    }

    if (inconsistencies.length > 0) {
      errorLines.push('Inconsistências detectadas nas configurações do Firebase:');
      inconsistencies.forEach((i) => errorLines.push(`  - ${i}`));
    }

    errorLines.push(
      'Defina as variáveis no ambiente frontend (.env ou runtime) para o projeto "itissimple-security-staging".',
      '================================================================================'
    );

    const errorMessage = errorLines.join('\n');
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
}

// Executa validação estrita antes da inicialização
validateFirebaseConfig();

// Configuração estrita do Firebase sem fallbacks ao projeto legado
const firebaseAppConfig = {
  apiKey: ACTIVE_FIREBASE_API_KEY,
  authDomain: ACTIVE_FIREBASE_AUTH_DOMAIN,
  projectId: ACTIVE_FIREBASE_PROJECT_ID,
  storageBucket: ACTIVE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: ACTIVE_PROJECT_NUMBER,
  appId: ACTIVE_FIREBASE_APP_ID,
};

// Inicialização segura do Firebase (evita duplicação de instâncias)
export const app = !getApps().length ? initializeApp(firebaseAppConfig) : getApp();

let authInstance: ReturnType<typeof getAuth>;
try {
  authInstance = initializeAuth(app, { persistence: inMemoryPersistence });
} catch {
  authInstance = getAuth(app);
}
export const auth = authInstance;

// Utiliza a instância do Firestore vinculada ao banco configurado com cache exclusivamente em memória
let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(app, { localCache: memoryLocalCache() }, ACTIVE_FIREBASE_DATABASE_ID);
} catch {
  dbInstance = getFirestore(app, ACTIVE_FIREBASE_DATABASE_ID);
}
export const db = dbInstance;

// Google Auth Provider
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
googleAuthProvider.addScope('https://www.googleapis.com/auth/calendar.events');
googleAuthProvider.addScope('https://www.googleapis.com/auth/gmail.send');
googleAuthProvider.addScope('https://www.googleapis.com/auth/drive.file');
googleAuthProvider.addScope('https://www.googleapis.com/auth/youtube.readonly');

export function getDb(): Firestore {
  return db;
}

export function getDefaultDb(): Firestore {
  return db;
}

export function getAllFirestoreDbs(): Firestore[] {
  return [db];
}

export default app;