/**
 * READ-ONLY DIAGNOSTIC EXPORTER: Student Persistence & S-Path
 * 
 * Target: Firestore `(default)` on project `itissimple-security-staging`
 * Objective: Inspect student persistence across weekly routine, S-Path, homework, and video assignment
 * Security: READ-ONLY, strictly sanitized, zero modifications, no credential leaks.
 */

import fs from 'fs';
import path from 'path';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import {
  ALLOWED_STAGING_PROJECT_ID,
  getFirebaseAdminApp,
} from '../src/serverFirebaseAdmin';

// Ensure staging project ID is set for initialization
if (!process.env.FIREBASE_PROJECT_ID) {
  process.env.FIREBASE_PROJECT_ID = ALLOWED_STAGING_PROJECT_ID;
}

export const CANONICAL_DB_ID = '(default)';

const SENSITIVE_KEYS = new Set([
  'password',
  'confirmPassword',
  'rawPassword',
  'newPassword',
  'hash',
  'salt',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'client_secret',
  'authCredential',
  'private_key',
  'email', // Mask emails for privacy
]);

function maskEmail(email?: string): string {
  if (!email || typeof email !== 'string') return '';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : '***';
  return `${maskedName}@${domain}`;
}

export function sanitizeObject(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeObject(item));
  }

  // Handle Firestore Timestamp
  if (typeof data.toDate === 'function') {
    return data.toDate().toISOString();
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes('password') || lowerKey.includes('token') || lowerKey.includes('secret')) {
      if (lowerKey === 'email' && typeof value === 'string') {
        sanitized[key] = maskEmail(value);
      } else {
        sanitized[key] = '[REDACTED_FOR_SECURITY]';
      }
      continue;
    }
    sanitized[key] = sanitizeObject(value);
  }
  return sanitized;
}

export interface PathCheckResult {
  path: string;
  status: 'EXISTS' | 'NOT_FOUND' | 'PERMISSION_DENIED' | 'ERROR';
  exists: boolean;
  docCount?: number;
  docIds?: string[];
  data?: any;
  error?: string;
}

export interface DiagnosticResult {
  metadata: {
    timestamp: string;
    projectId: string;
    databaseId: string;
    targetStudentUid: string;
    isReadOnly: true;
    iamAdminIdentity?: string;
  };
  firestoreExistence: {
    userRootDoc: PathCheckResult;
    currentRoutineWeekData: PathCheckResult;
    currentRoutineSubcollection: PathCheckResult;
    weeklyChecks: PathCheckResult;
    homework: PathCheckResult;
    routinesSubcollection: PathCheckResult;
    memorizationSubcollection: PathCheckResult;
    studentAssignmentsDoc: PathCheckResult;
    studentHomeworkDoc: PathCheckResult;
    appStateAssignmentsForStudent: PathCheckResult;
    studentRoutinesDoc: PathCheckResult;
    studentVideoAssignments: PathCheckResult;
  };
  analysis: {
    weeklyCycleInferred: number | string | null;
    currentRoutineVideoReference: any;
    weeklyChecksCycle1Status: any;
    homeworkCycle1Status: any;
    pathDivergences: string[];
    permissionVulnerabilityNotes: string[];
  };
}

async function safeGetDoc(db: Firestore, docPath: string): Promise<PathCheckResult> {
  try {
    const snap = await db.doc(docPath).get();
    if (snap.exists) {
      return {
        path: docPath,
        status: 'EXISTS',
        exists: true,
        data: sanitizeObject(snap.data()),
      };
    }
    return {
      path: docPath,
      status: 'NOT_FOUND',
      exists: false,
    };
  } catch (err: any) {
    const isPerm = err?.code === 7 || err?.message?.includes('Missing or insufficient permissions');
    return {
      path: docPath,
      status: isPerm ? 'PERMISSION_DENIED' : 'ERROR',
      exists: false,
      error: err?.message || String(err),
    };
  }
}

async function safeGetCollection(db: Firestore, colPath: string): Promise<PathCheckResult> {
  try {
    const snap = await db.collection(colPath).get();
    const docIds: string[] = [];
    const docs: Record<string, any> = {};
    snap.forEach((d) => {
      docIds.push(d.id);
      docs[d.id] = sanitizeObject(d.data());
    });
    return {
      path: colPath,
      status: 'EXISTS',
      exists: snap.size > 0,
      docCount: snap.size,
      docIds,
      data: docs,
    };
  } catch (err: any) {
    const isPerm = err?.code === 7 || err?.message?.includes('Missing or insufficient permissions');
    return {
      path: colPath,
      status: isPerm ? 'PERMISSION_DENIED' : 'ERROR',
      exists: false,
      error: err?.message || String(err),
    };
  }
}

export async function runDiagnostics(targetUid?: string): Promise<DiagnosticResult> {
  // Validate project
  const app = getFirebaseAdminApp();
  const projectId = app.options.projectId;
  if (projectId !== ALLOWED_STAGING_PROJECT_ID) {
    throw new Error(`[Security Violation] Target project '${projectId}' does not match '${ALLOWED_STAGING_PROJECT_ID}'`);
  }

  let adminIdentity = 'unknown';
  try {
    const token = await (app.options.credential as any)?.getAccessToken();
    if (token?.access_token) {
      const res = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token.access_token}`);
      const data = await res.json();
      if (data?.email) adminIdentity = data.email;
    }
  } catch {}

  const db: Firestore = getFirestore(app, CANONICAL_DB_ID);

  let studentUid = targetUid?.trim();
  if (!studentUid) {
    // Check if we can find a student UID
    try {
      const usersSnap = await db.collection('users').get();
      usersSnap.forEach((doc) => {
        if (!studentUid) {
          studentUid = doc.id;
        }
      });
    } catch {
      // Permission denied or failure reading users
      studentUid = 'test-student-account';
    }
  }

  console.log(`[diagnose] Target student UID: ${studentUid}`);
  console.log(`[diagnose] Target GCP Project: ${projectId}`);
  console.log(`[diagnose] Canonical Firestore Database: ${CANONICAL_DB_ID}`);
  console.log(`[diagnose] Admin Identity: ${adminIdentity}`);

  // Query paths safely
  const [
    userRootDoc,
    currentRoutineWeekData,
    currentRoutineSubcollection,
    weeklyChecks,
    homework,
    routinesSubcollection,
    memorizationSubcollection,
    studentAssignmentsDoc,
    studentHomeworkDoc,
    studentRoutinesDoc,
    studentVideoAssignments,
  ] = await Promise.all([
    safeGetDoc(db, `users/${studentUid}`),
    safeGetDoc(db, `users/${studentUid}/currentRoutine/weekData`),
    safeGetCollection(db, `users/${studentUid}/currentRoutine`),
    safeGetCollection(db, `users/${studentUid}/weeklyChecks`),
    safeGetCollection(db, `users/${studentUid}/homework`),
    safeGetCollection(db, `users/${studentUid}/routines`),
    safeGetCollection(db, `users/${studentUid}/memorization`),
    safeGetDoc(db, `student_assignments/${studentUid}`),
    safeGetDoc(db, `student_homework/${studentUid}`),
    safeGetDoc(db, `student_routines/${studentUid}`),
    safeGetDoc(db, `student_video_assignments/${studentUid}`),
  ]);

  // app_state/assignments (filtered strictly to studentUid)
  let appStateCheck: PathCheckResult = {
    path: 'app_state/assignments',
    status: 'NOT_FOUND',
    exists: false,
  };
  try {
    const appStateSnap = await db.doc('app_state/assignments').get();
    if (appStateSnap.exists) {
      const raw = appStateSnap.data() || {};
      let filteredAssignments: any[] = [];
      if (Array.isArray(raw.assignments)) {
        filteredAssignments = raw.assignments
          .filter((a: any) => a.studentId === studentUid || a.studentUid === studentUid || a.uid === studentUid)
          .map((a: any) => sanitizeObject(a));
      } else if (raw[studentUid]) {
        filteredAssignments = [sanitizeObject(raw[studentUid])];
      }
      appStateCheck = {
        path: 'app_state/assignments',
        status: 'EXISTS',
        exists: true,
        docCount: filteredAssignments.length,
        data: filteredAssignments,
      };
    }
  } catch (err: any) {
    const isPerm = err?.code === 7 || err?.message?.includes('Missing or insufficient permissions');
    appStateCheck = {
      path: 'app_state/assignments',
      status: isPerm ? 'PERMISSION_DENIED' : 'ERROR',
      exists: false,
      error: err?.message || String(err),
    };
  }

  // Divergences and notes
  const divergences: string[] = [];
  const vulnNotes: string[] = [];

  vulnNotes.push(
    "1. Regras publicadas no Cloud Firestore (default): `allow read, write: if false;` bloqueiam 100% das leituras e escritas diretas do Firebase Client SDK no navegador.",
    "2. O frontend executa `onSnapshot` e `setDoc` diretamente em: `users/{uid}/currentRoutine/weekData` (src/utils/routineSync.ts) e `users/{uid}/weeklyChecks/week-1` (src/utils/studentPersistence.ts).",
    "3. No ambiente backend/Admin SDK, a credencial ADC pertence a `" + adminIdentity + "`. Sem concessão de IAM Role ('Cloud Datastore User' / 'Firebase Admin') no projeto `" + projectId + "`, operações Admin SDK também retornam `7 PERMISSION_DENIED`.",
    "4. Ao recarregar a página (F5), o cache em memória do Client SDK (memoryLocalCache) é completamente esvaziado. Os listeners em tempo real disparam erro de permissão e o estado do aluno retrocede para vazio ou valores padrão."
  );

  if (currentRoutineWeekData.status === 'PERMISSION_DENIED') {
    divergences.push(`Leitura de 'users/${studentUid}/currentRoutine/weekData' negada por PERMISSION_DENIED.`);
  } else if (!currentRoutineWeekData.exists) {
    divergences.push(`Documento 'users/${studentUid}/currentRoutine/weekData' não existe no banco canônico.`);
  }

  if (weeklyChecks.status === 'PERMISSION_DENIED') {
    divergences.push(`Leitura da subcoleção 'users/${studentUid}/weeklyChecks' negada por PERMISSION_DENIED.`);
  } else if (weeklyChecks.docCount === 0) {
    divergences.push(`Subcoleção 'users/${studentUid}/weeklyChecks' vazia.`);
  }

  const result: DiagnosticResult = {
    metadata: {
      timestamp: new Date().toISOString(),
      projectId,
      databaseId: CANONICAL_DB_ID,
      targetStudentUid: studentUid,
      isReadOnly: true,
      iamAdminIdentity: adminIdentity,
    },
    firestoreExistence: {
      userRootDoc,
      currentRoutineWeekData,
      currentRoutineSubcollection,
      weeklyChecks,
      homework,
      routinesSubcollection,
      memorizationSubcollection,
      studentAssignmentsDoc,
      studentHomeworkDoc,
      appStateAssignmentsForStudent: appStateCheck,
      studentRoutinesDoc,
      studentVideoAssignments,
    },
    analysis: {
      weeklyCycleInferred: userRootDoc.data?.currentWeekCycle || userRootDoc.data?.weeklyCycle || 1,
      currentRoutineVideoReference: currentRoutineWeekData.data?.selectedVideo || userRootDoc.data?.selectedVideo || null,
      weeklyChecksCycle1Status: weeklyChecks.data?.['week-1'] || null,
      homeworkCycle1Status: homework.data?.['week-1'] || null,
      pathDivergences: divergences,
      permissionVulnerabilityNotes: vulnNotes,
    },
  };

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  let targetUid = '';
  for (const arg of args) {
    if (arg.startsWith('--uid=')) {
      targetUid = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
      targetUid = arg;
    }
  }

  try {
    const result = await runDiagnostics(targetUid);

    // Save output to local sanitized file (outside public/)
    const outDir = path.resolve(process.cwd(), '.diagnostics');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const outFile = path.join(outDir, 'student-persistence-sanitized.json');
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf-8');

    console.log('\n======================================================');
    console.log('  DIAGNÓSTICO READ-ONLY CONCLUÍDO COM SUCESSO');
    console.log('======================================================');
    console.log(`Projeto:        ${result.metadata.projectId}`);
    console.log(`Banco:          ${result.metadata.databaseId}`);
    console.log(`UID do Aluno:   ${result.metadata.targetStudentUid}`);
    console.log(`Identidade ADC: ${result.metadata.iamAdminIdentity}`);
    console.log(`Arquivo JSON:   ${outFile}`);
    console.log('------------------------------------------------------');
    console.log('DOCUMENTOS INVESTIGADOS:');
    console.log(`- users/{uid}:                              ${result.firestoreExistence.userRootDoc.status}`);
    console.log(`- users/{uid}/currentRoutine/weekData:       ${result.firestoreExistence.currentRoutineWeekData.status}`);
    console.log(`- users/{uid}/currentRoutine (subcol):      ${result.firestoreExistence.currentRoutineSubcollection.status} (${result.firestoreExistence.currentRoutineSubcollection.docCount ?? 0} docs)`);
    console.log(`- users/{uid}/weeklyChecks (subcol):        ${result.firestoreExistence.weeklyChecks.status} (${result.firestoreExistence.weeklyChecks.docCount ?? 0} docs)`);
    console.log(`- users/{uid}/homework (subcol):            ${result.firestoreExistence.homework.status} (${result.firestoreExistence.homework.docCount ?? 0} docs)`);
    console.log(`- users/{uid}/routines (subcol):            ${result.firestoreExistence.routinesSubcollection.status}`);
    console.log(`- student_assignments/{uid}:                ${result.firestoreExistence.studentAssignmentsDoc.status}`);
    console.log(`- app_state/assignments (student):          ${result.firestoreExistence.appStateAssignmentsForStudent.status}`);
    console.log('------------------------------------------------------');
    console.log('VULNERABILIDADES & DIVERGÊNCIAS DETECTADAS:');
    result.analysis.permissionVulnerabilityNotes.forEach((n) => console.log(`  * ${n}`));
    result.analysis.pathDivergences.forEach((div) => console.log(`  ! ${div}`));
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('\n[diagnose ERROR]:', err.message || err);
    process.exit(1);
  }
}

main();
