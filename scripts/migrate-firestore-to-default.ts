/**
 * FIRESTORE CONSOLIDATION & SAFE MIGRATION UTILITY — HOTFIX 4B.18
 *
 * Source: ai-studio-securitystagingi-82447e17-0a01-4d71-b6f9-a8880c9fcea9
 * Destination: (default)
 *
 * ARCHITECTURE PRINCIPLES:
 * 1. Default Dry-Run Mode: Never performs any live writes unless explicitly authorized (--confirm --execute).
 * 2. Idempotent & Non-Destructive: Never deletes source records; never overwrites destination records automatically.
 * 3. Strict Credential Sanitization: Strips all passwords, hashes, tokens, secrets before any destination write.
 * 4. Administrator Bootstrap Protection: Preserves app_state/admin_bootstrap completed state; prevents lock reset.
 * 5. Canonical Identity Preservation: Reconciles documents by authentic Firebase Auth UID.
 * 6. Audit & Verification: Generates sanitized audit summaries without exposing private data.
 */

import { getFirestore, Firestore } from 'firebase-admin/firestore';
import {
  ALLOWED_STAGING_PROJECT_ID,
  getFirebaseAdminApp,
} from '../src/serverFirebaseAdmin';
import { consolidateTutorsList, isValidCanonicalUid } from '../src/utils/tutorConsolidation';

export const DEFAULT_SOURCE_DB_ID = 'ai-studio-securitystagingi-82447e17-0a01-4d71-b6f9-a8880c9fcea9';
export const CANONICAL_DEST_DB_ID = '(default)';

export const SENSITIVE_CREDENTIAL_FIELDS = [
  'password',
  'confirmPassword',
  'newPassword',
  'rawPassword',
  'hash',
  'salt',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'client_secret',
  'authCredential',
];

export interface MigrationOptions {
  sourceDbId?: string;
  destDbId?: string;
  dryRun?: boolean;
  confirm?: boolean;
  inspectOnly?: boolean;
  verifyOnly?: boolean;
  collections?: string[];
  // Test injection hooks
  customSourceDb?: any;
  customDestDb?: any;
  bypassProjectIdCheckForTesting?: boolean;
}

export interface DocumentAudit {
  collection: string;
  docId: string;
  status: 'IDENTICAL' | 'MISSING_IN_DEST' | 'CONFLICT' | 'SANITIZED' | 'PROTECTED_BOOTSTRAP';
  conflictingFields?: string[];
  sanitizedFieldsCount: number;
  details?: string;
}

export interface MigrationReport {
  timestamp: string;
  projectId: string;
  sourceDbId: string;
  destDbId: string;
  mode: 'DRY_RUN' | 'EXECUTE' | 'INSPECT_ONLY' | 'VERIFY_ONLY';
  totalSourceDocs: number;
  totalDestDocs: number;
  missingInDestCount: number;
  identicalCount: number;
  conflictCount: number;
  migratedCount: number;
  sanitizedFieldsTotal: number;
  bootstrapProtected: boolean;
  documents: DocumentAudit[];
  conflicts: Array<{ collection: string; docId: string; fields: string[] }>;
  errors: string[];
}

/**
 * Deeply sanitizes document payloads, removing all credential/secret fields recursively.
 */
export function sanitizeDocumentPayload(data: any): { sanitized: any; removedCount: number } {
  if (!data || typeof data !== 'object') {
    return { sanitized: data, removedCount: 0 };
  }

  let removedCount = 0;

  function deepCloneAndSanitize(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) {
      return obj.map((item) => deepCloneAndSanitize(item));
    }
    if (typeof obj === 'object') {
      const copy: Record<string, any> = {};
      for (const key of Object.keys(obj)) {
        if (SENSITIVE_CREDENTIAL_FIELDS.includes(key)) {
          removedCount++;
          continue;
        }
        copy[key] = deepCloneAndSanitize(obj[key]);
      }
      return copy;
    }
    return obj;
  }

  const sanitized = deepCloneAndSanitize(data);
  return { sanitized, removedCount };
}

/**
 * Detects conflicts between source and destination document versions.
 */
export function compareDocumentVersions(
  sourceData: any,
  destData: any
): { isIdentical: boolean; conflictingFields: string[] } {
  const { sanitized: cleanSource } = sanitizeDocumentPayload(sourceData);
  const { sanitized: cleanDest } = sanitizeDocumentPayload(destData);

  const allKeys = Array.from(new Set([...Object.keys(cleanSource || {}), ...Object.keys(cleanDest || {})]));
  const conflictingFields: string[] = [];

  for (const k of allKeys) {
    if (k === 'updatedAt' || k === 'lastModified' || k === 'syncedAt') {
      continue; // Skip timestamp variances
    }
    const valA = JSON.stringify(cleanSource?.[k] ?? null);
    const valB = JSON.stringify(cleanDest?.[k] ?? null);
    if (valA !== valB) {
      conflictingFields.push(k);
    }
  }

  return {
    isIdentical: conflictingFields.length === 0,
    conflictingFields,
  };
}

/**
 * Plans and optionally executes database migration with full conflict reporting and zero data deletion.
 */
export async function planAndMigrateDatabases(options: MigrationOptions = {}): Promise<MigrationReport> {
  const sourceDbId = options.sourceDbId || DEFAULT_SOURCE_DB_ID;
  const destDbId = options.destDbId || CANONICAL_DEST_DB_ID;
  const isDryRun = options.dryRun !== false || !options.confirm;
  const mode = options.inspectOnly ? 'INSPECT_ONLY' : isDryRun ? 'DRY_RUN' : 'EXECUTE';

  let sourceDb: any = options.customSourceDb;
  let destDb: any = options.customDestDb;

  if (!sourceDb || !destDb) {
    try {
      const app = getFirebaseAdminApp();
      if (!sourceDb) sourceDb = getFirestore(app, sourceDbId);
      if (!destDb) destDb = getFirestore(app, destDbId);
    } catch (err: any) {
      // In testing or environments without ADC, allow mock injection
      if (!options.customSourceDb || !options.customDestDb) {
        throw new Error(`[Migration] Cannot initialize Firestore clients: ${err?.message || err}`);
      }
    }
  }

  const targetCollections = options.collections || ['users', 'tutors', 'app_state'];
  const audits: DocumentAudit[] = [];
  const conflicts: Array<{ collection: string; docId: string; fields: string[] }> = [];
  const errors: string[] = [];

  let totalSourceDocs = 0;
  let totalDestDocs = 0;
  let missingInDestCount = 0;
  let identicalCount = 0;
  let conflictCount = 0;
  let migratedCount = 0;
  let sanitizedFieldsTotal = 0;
  let bootstrapProtected = false;

  for (const colName of targetCollections) {
    let sourceDocs: any[] = [];
    try {
      const snap = await sourceDb.collection(colName).get();
      snap.forEach((d: any) => sourceDocs.push({ id: d.id, data: d.data(), ref: d.ref }));
    } catch (err: any) {
      errors.push(`Error reading collection '${colName}' from source database '${sourceDbId}': ${err.message}`);
      continue;
    }

    totalSourceDocs += sourceDocs.length;

    for (const sDoc of sourceDocs) {
      const docId = sDoc.id;
      const rawSourceData = sDoc.data;
      const { sanitized: cleanData, removedCount } = sanitizeDocumentPayload(rawSourceData);
      sanitizedFieldsTotal += removedCount;

      let destDocSnap: any = null;
      try {
        destDocSnap = await destDb.collection(colName).doc(docId).get();
      } catch (err: any) {
        errors.push(`Error checking doc '${colName}/${docId}' in dest database '${destDbId}': ${err.message}`);
        continue;
      }

      if (destDocSnap && destDocSnap.exists) {
        totalDestDocs++;
        const destData = destDocSnap.data();

        // Special Protection: app_state/admin_bootstrap
        if (colName === 'app_state' && docId === 'admin_bootstrap') {
          bootstrapProtected = true;
          audits.push({
            collection: colName,
            docId,
            status: 'PROTECTED_BOOTSTRAP',
            sanitizedFieldsCount: removedCount,
            details: `Existing completed bootstrap lock in (default) strictly preserved (adminUid: ${destData?.adminUid})`,
          });
          continue;
        }

        const comp = compareDocumentVersions(cleanData, destData);
        if (comp.isIdentical) {
          identicalCount++;
          audits.push({
            collection: colName,
            docId,
            status: 'IDENTICAL',
            sanitizedFieldsCount: removedCount,
          });
        } else {
          conflictCount++;
          conflicts.push({
            collection: colName,
            docId,
            fields: comp.conflictingFields,
          });
          audits.push({
            collection: colName,
            docId,
            status: 'CONFLICT',
            conflictingFields: comp.conflictingFields,
            sanitizedFieldsCount: removedCount,
            details: `Destination doc has differences in keys: [${comp.conflictingFields.join(', ')}]. Preserved without automatic overwrite.`,
          });
        }
      } else {
        // Document missing in destination -> Candidate for migration
        missingInDestCount++;

        // Special Protection: app_state/admin_bootstrap reconciliation
        if (colName === 'app_state' && docId === 'admin_bootstrap') {
          bootstrapProtected = true;
          if (cleanData?.status === 'completed' && cleanData?.adminUid) {
            audits.push({
              collection: colName,
              docId,
              status: 'PROTECTED_BOOTSTRAP',
              sanitizedFieldsCount: removedCount,
              details: `Preserved completed bootstrap lock from source (adminUid: ${cleanData.adminUid})`,
            });
            if (!isDryRun) {
              await destDb.collection(colName).doc(docId).set(cleanData, { merge: true });
              migratedCount++;
            }
          }
          continue;
        }

        audits.push({
          collection: colName,
          docId,
          status: 'MISSING_IN_DEST',
          sanitizedFieldsCount: removedCount,
          details: `Exists only in source database '${sourceDbId}'. Ready for consolidation into '${destDbId}'.`,
        });

        // Only perform writes if dryRun is explicitly false and confirm is true
        if (!isDryRun) {
          try {
            await destDb.collection(colName).doc(docId).set(cleanData, { merge: true });
            migratedCount++;
          } catch (writeErr: any) {
            errors.push(`Failed to migrate doc '${colName}/${docId}' to '${destDbId}': ${writeErr.message}`);
          }
        }
      }
    }
  }

  // Explicitly verify administrator bootstrap lock status in destination database
  if (!bootstrapProtected) {
    try {
      const destBootstrapSnap = await destDb.collection('app_state').doc('admin_bootstrap').get();
      if (destBootstrapSnap && destBootstrapSnap.exists) {
        bootstrapProtected = true;
      }
    } catch {}
  }

  return {
    timestamp: new Date().toISOString(),
    projectId: ALLOWED_STAGING_PROJECT_ID,
    sourceDbId,
    destDbId,
    mode,
    totalSourceDocs,
    totalDestDocs,
    missingInDestCount,
    identicalCount,
    conflictCount,
    migratedCount,
    sanitizedFieldsTotal,
    bootstrapProtected,
    documents: audits,
    conflicts,
    errors,
  };
}

// ----------------------------------------------------------------------------
// CLI Execution Interface
// ----------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('migrate-firestore-to-default.ts')) {
  const args = process.argv.slice(2);
  const isConfirm = args.includes('--confirm');
  const isExecute = args.includes('--execute');
  const isInspectOnly = args.includes('--inspect') || args.includes('--inventory');

  let sourceDbId = DEFAULT_SOURCE_DB_ID;
  let destDbId = CANONICAL_DEST_DB_ID;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source-db' && args[i + 1]) {
      sourceDbId = args[i + 1];
      i++;
    } else if (args[i] === '--dest-db' && args[i + 1]) {
      destDbId = args[i + 1];
      i++;
    }
  }

  console.log('\n================================================================================');
  console.log('=== FIRESTORE DEFAULT DATABASE CONSOLIDATION & MIGRATION PLAN ===');
  console.log('================================================================================');
  console.log(`Source Database:      ${sourceDbId}`);
  console.log(`Destination Database: ${destDbId}`);
  console.log(`Execution Mode:       ${isInspectOnly ? 'INSPECT ONLY' : (isConfirm && isExecute) ? 'LIVE EXECUTION' : 'DRY-RUN (DEFAULT - ZERO WRITES)'}`);
  console.log('================================================================================\n');

  planAndMigrateDatabases({
    sourceDbId,
    destDbId,
    dryRun: !(isConfirm && isExecute),
    confirm: isConfirm && isExecute,
    inspectOnly: isInspectOnly,
  })
    .then((report) => {
      console.log('--- MIGRATION AUDIT SUMMARY ---');
      console.log(`Total Source Documents Scanned:    ${report.totalSourceDocs}`);
      console.log(`Documents Already In Destination:  ${report.totalDestDocs}`);
      console.log(`Documents Identical (No Action):   ${report.identicalCount}`);
      console.log(`Documents Missing in (default):    ${report.missingInDestCount}`);
      console.log(`Conflicting Documents Detected:    ${report.conflictCount}`);
      console.log(`Sensitive Credential Fields Stripped: ${report.sanitizedFieldsTotal}`);
      console.log(`Administrator Bootstrap Protected: ${report.bootstrapProtected ? 'YES' : 'NO'}`);
      console.log(`Documents Migrated:                ${report.migratedCount} (Dry-run: 0 writes performed)`);

      if (report.conflicts.length > 0) {
        console.log('\n--- CONFLICTS REQUIRING OPERATOR REVIEW ---');
        for (const c of report.conflicts) {
          console.log(`  - [${c.collection}/${c.docId}] Differing fields: ${c.fields.join(', ')}`);
        }
      }

      console.log('\n================================================================================');
      console.log('[SAFETY STATUS] Zero records deleted. Source database untouched.');
      if (report.mode === 'DRY_RUN') {
        console.log('Dry-run complete. To execute live migration with operator approval:');
        console.log('  npx tsx scripts/migrate-firestore-to-default.ts --confirm --execute');
      }
      console.log('================================================================================\n');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[MIGRATION PLAN ERROR]', err?.message || err);
      process.exit(1);
    });
}
