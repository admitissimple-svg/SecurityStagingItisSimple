#!/usr/bin/env bash
# ==============================================================================
# ARCH.2G.2 — Cloud Shell Firestore (default) Integral Backup & Full Test Reset
# ==============================================================================
# Projeto alvo esperado: itissimple-security-staging
# Banco alvo exclusivo : (default)
#
# Modos obrigatórios:
#   --backup-only     Inspeciona o projeto real, verifica serviços ativos,
#                     lista usuários do Firebase Auth (sem expor credenciais),
#                     executa BACKUP INTEGRAL RESTAURÁVEL nativo em GCS
#                     ('gcloud firestore export'), gera dump sanitizado apenas
#                     para auditoria offline e produz o plano determinístico de
#                     reset de dados de teste (somente leitura).
#
#   --execute-clean   Executa o reset/limpeza exclusivamente após validar:
#                     - backup integral restaurável verificado no GCS
#                     - manifesto COMPLETED + checksums SHA-256
#                     - confirmação explícita de projeto e planHash
#                     - trava contra processos ativos / restauração de caches
#                     - confirmação interativa final. Suporta --resume.
#
# Garantias de Segurança:
#   - Nunca depende de credenciais do sandbox AI Studio nem de chaves JSON.
#   - Usa exclusivamente a sessão autenticada do operador no Cloud Shell (gcloud).
#   - Nunca imprime ou grava tokens OAuth, hashes de senha, salts ou segredos.
#   - Nunca altera ou exclui contas, UIDs ou custom claims do Firebase Auth.
#   - Nunca altera firestore.rules nem realiza deploy.
#   - Nunca considera firestore-default-export.json (sanitizado) como backup integral.
# ==============================================================================

set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] Node.js (>= 18) é obrigatório no Google Cloud Shell." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "parseInt(process.versions.node.split('.')[0], 10)")"
if [ "${NODE_MAJOR}" -lt 18 ]; then
  echo "[ERRO] Node.js >= 18 é necessário (versão atual: $(node -v))." >&2
  exit 1
fi

TMP_JS="$(mktemp /tmp/arch2g1-firestore-clean.XXXXXX.mjs)"
cleanup_tmp() {
  rm -f "${TMP_JS}"
}
trap cleanup_tmp EXIT

cat <<'__ARCH2G1_NODE_EOF__' > "${TMP_JS}"
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import { execFileSync } from 'child_process';

const EXPECTED_PROJECT_ID = 'itissimple-security-staging';
const FORBIDDEN_LEGACY_PROJECT_IDS = new Set(['itissimple-8663d']);
const TARGET_DATABASE_ID = '(default)';
const PROTECTED_ADMIN_EMAILS = new Set(['adm.itissimple@gmail.com']);
const MAINTENANCE_LOCK_DOC_PATH = '_maintenance_locks/arch_2g_cleanup';
const MAINTENANCE_LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutos
const DEFAULT_BACKUP_MAX_AGE_HOURS = 24;

// Campos sensíveis que NUNCA devem ser expostos em logs, relatórios, dumps de Auth ou exports
const SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'confirmPassword',
  'newPassword',
  'rawPassword',
  'passwordHash',
  'salt',
  'secret',
  'client_secret',
  'clientSecret',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'oauthIdToken',
  'apiKey',
  'authCredential',
  'privateKey',
  'private_key',
  'tokensValidAfterTime',
  'validSince',
]);

// Coleções descontinuadas / efêmeras / diagnóstico: elegíveis para exclusão integral
const DISCONTINUED_COLLECTIONS = new Set([
  'live_lessons',
  'student_homework',
  '_diagnostic_probes',
  'gemini_inflight_locks',
  'gemini_rate_limits',
]);

// Coleções estruturais / operacionais do sistema: preservadas integralmente
const STRUCTURAL_PRESERVED_COLLECTIONS = new Set(['ptax_rates']);

// Documentos estruturais protegidos em app_state/*
const PROTECTED_APP_STATE_DOCS = new Set([
  'admin_bootstrap',
  'youtube_playlists',
  'youtube_auth',
]);

// Documentos legados de app_state/* a serem removidos integralmente
const DELETABLE_APP_STATE_DOCS = new Set([
  'assignments',
  'main',
]);

// Subcoleções canônicas de users/{uid}
const CANONICAL_USER_SUBCOLLECTIONS = new Set([
  'routines',
  'currentRoutine',
  'weeklyChecks',
  'homework',
  'weeklyHistory',
  'vocabulary',
  'journal',
  'activity_journal',
  'session_notes',
  'lessons',
  'memorization',
]);

// Subcoleções integralmente legadas de users/{uid}
const LEGACY_USER_SUBCOLLECTIONS = new Set(['studentJournal']);

// Coleções relacionais/perfil de usuários/aulas que carregam dados de teste no ARCH.2G.2
const USER_SCOPED_COLLECTIONS = new Set([
  'tutors',
  'student_assignments',
  'teacher_availability',
]);

const RELATIONAL_TEST_DATA_COLLECTIONS = new Set([
  'lessons',
  'session_notes',
  'direct_messages',
  'lesson_insights',
  'financial_transactions',
]);

// Campos estruturais preservados em users/{adminUid} no reset completo ARCH.2G.2
const FULL_RESET_ADMIN_ROOT_KEEP_FIELDS = new Set([
  'uid',
  'id',
  'email',
  'name',
  'role',
  'isBootstrappedAdmin',
  'bootstrappedAt',
  'createdAt',
  'updatedAt',
]);

// Campos de espelho/cache legado em app_state/main_data
const LEGACY_MAIN_DATA_FIELDS = [
  'userProfiles',
  'authUsers',
  'students',
  'deletedStudentEmails',
  'deletedTutorEmails',
  'deletedTutorIds',
  'emailLogs',
  'transactions',
  'studentDictionaryMap',
  'sessionNotesMap',
  'sessionNotesProgressMap',
  'pedagogicalTransformationsMap',
  'liveLessons',
  'lessons',
  'scheduledLessons',
  'studentJournalMap',
  'weeklyHomework',
  'studentHomeworkMap',
  'studentRoutinesMap',
  'studentCurrentRoutines',
  'routinesByDay',
  'studentWeeklyChecks',
  'weeklyNativeTargets',
  'studentVideoAssignments',
  'studentSpotifyAssignments',
  'studentWatchedVideos',
  'studentListenedTracks',
  'studentAwaitingTopicSelection',
  'weeklyStudyDays',
  'weeklyStudyDaysTargets',
  'tutorsList',
  'teachers',
  'contractedLessons',
];

// Campos estruturais preservados em app_state/main_data (modo seletivo ARCH.2G.1)
const STRUCTURAL_MAIN_DATA_FIELDS = new Set([
  'landingContent',
  'meetSettings',
  'teacherSettings',
  'spotifyPlaylists',
  'updatedAt',
]);

// Campos estruturais preservados em app_state/main_data no reset completo ARCH.2G.2
// (remove inclusive meetSettings, teacherSettings, chatMessages, dictionary, studentActivityJournal, etc.)
const FULL_RESET_STRUCTURAL_MAIN_DATA_FIELDS = new Set([
  'landingContent',
  'spotifyPlaylists',
  'updatedAt',
]);

// Campos estruturais preservados em app_state/routines no reset completo ARCH.2G.2
const FULL_RESET_STRUCTURAL_ROUTINES_FIELDS = new Set([
  'routinesByDay',
  'updatedAt',
]);

// Campos legados em app_state/routines (preserva routinesByDay)
const LEGACY_ROUTINES_FIELDS = [
  'studentRoutinesMap',
  'studentCurrentRoutines',
  'weeklyNativeTargets',
  'studentWeeklyChecks',
];

// Campos legados em app_state/lessons
const LEGACY_LESSONS_FIELDS = [
  'liveLessons',
  'lessons',
  'scheduledLessons',
  'weeklyHomework',
  'studentHomeworkMap',
];

// Campos legados na raiz de users/{uid} (nunca removemos sem critério seguro)
const LEGACY_USER_ROOT_FIELDS_SAFE = [
  'password',
  'confirmPassword',
  'newPassword',
  'rawPassword',
  'hash',
  'salt',
  'scheduledLessons',
  'weeklyChecks',
  'sPathChecks',
  'weeklyHomework',
  'nativeNotesReview',
  'lastReminderShownDate',
];

const TEST_EMAIL_DOMAINS = [
  '@example.com',
  '@test.com',
  '@mailinator.com',
  '@tempmail.com',
  '@yopmail.com',
];

function printUsage(exitCode = 0) {
  console.log(`
ARCH.2G.2 — Reset Completo de Dados de Teste e Limpeza Segura do Firestore (default)

USO:
  ./scripts/cloudshell-firestore-clean.sh --backup-only --gcs-bucket gs://SEU-BUCKET-BACKUP [opções]
  ./scripts/cloudshell-firestore-clean.sh --execute-clean --backup-dir <dir> --confirm-project <id> --confirm-plan-hash <hash> [opções]

MODOS OBRIGATÓRIOS (mutuamente exclusivos):
  --backup-only                     Modo somente leitura: valida projeto (default), audita escritores
                                    ativos, lista usuários Auth (sem credenciais), executa export
                                    nativo RESTAURÁVEL no GCS ('gcloud firestore export'), gera dump
                                    sanitizado para auditoria offline e plano determinístico ARCH.2G.2.
  --execute-clean                   Executa exclusões/sanitizações após verificar backup integral no
                                    GCS, manifesto COMPLETED, checksums, confirmação de projeto/hash e trava.

OPÇÕES DE BACKUP (--backup-only):
  --project <id>                    ID do projeto GCP/Firebase (padrão: gcloud config/env ou ${EXPECTED_PROJECT_ID})
  --allow-non-default-project       Permite executar em projeto diferente de ${EXPECTED_PROJECT_ID} (exceto legados bloqueados)
  --output-dir <dir>                Diretório de saída do inventário (padrão: $HOME/itissimple-arch2g2-backups/<proj>-<ts>)
  --gcs-bucket <gs://bucket>        OBRIGATÓRIO para backup restaurável: bucket GCS para 'gcloud firestore export'
  --allow-audit-only-without-gcs    Apenas inspeção offline (NÃO gera backup restaurável; bloqueia --execute-clean)
  --selective-legacy                Usa classificação seletiva ARCH.2G.1 em vez do reset completo ARCH.2G.2
  --clean-test-uids <u1,u2>         (Modo seletivo) UIDs de QA no Auth cujos dados Firestore devem ser limpos
  --clean-test-emails <e1,e2>       (Modo seletivo) E-mails de QA no Auth cujos dados Firestore devem ser limpos

OPÇÕES DE EXECUÇÃO (--execute-clean):
  --backup-dir <dir>                Diretório de backup gerado pelo --backup-only (OBRIGATÓRIO)
  --confirm-project <id>            Confirmação explícita do ID do projeto alvo (OBRIGATÓRIO)
  --confirm-plan-hash <hash>        Confirmação explícita do hash do inventário/plano (mín. 12 chars ou completo) (OBRIGATÓRIO)
  --resume                          Retoma execução interrompida usando execution-journal.jsonl de forma idempotente
  --quiesce-cloud-run               Ativa temporariamente DIAGNOSTIC_ONLY=true no Cloud Run durante o reset e reinicia revisão limpa ao final
  --acknowledge-no-active-writers   Confirma ausência de escritores externos (preview, tsx local, Cloud Scheduler/Functions)
  --allow-stale-backup              Permite usar backup com mais de ${DEFAULT_BACKUP_MAX_AGE_HOURS}h
  --help, -h                        Exibe esta ajuda
`);
  process.exit(exitCode);
}

export function parseCliArgs(argv) {
  const opts = {
    backupOnly: false,
    executeClean: false,
    project: '',
    allowNonDefaultProject: false,
    outputDir: '',
    gcsBucket: '',
    allowAuditOnlyWithoutGcs: false,
    selectiveLegacy: false,
    cleanTestUids: [],
    cleanTestEmails: [],
    backupDir: '',
    confirmProject: '',
    confirmPlanHash: '',
    resume: false,
    quiesceCloudRun: false,
    acknowledgeNoActiveWriters: false,
    allowStaleBackup: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) {
        throw new Error(`Argumento ausente após '${arg}'.`);
      }
      return argv[++i];
    };
    switch (arg) {
      case '--backup-only':
        opts.backupOnly = true;
        break;
      case '--execute-clean':
        opts.executeClean = true;
        break;
      case '--project':
        opts.project = next().trim();
        break;
      case '--allow-non-default-project':
        opts.allowNonDefaultProject = true;
        break;
      case '--output-dir':
        opts.outputDir = next().trim();
        break;
      case '--gcs-bucket':
        opts.gcsBucket = next().trim();
        break;
      case '--allow-audit-only-without-gcs':
        opts.allowAuditOnlyWithoutGcs = true;
        break;
      case '--selective-legacy':
        opts.selectiveLegacy = true;
        break;
      case '--clean-test-uids':
        opts.cleanTestUids.push(
          ...next()
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        );
        break;
      case '--clean-test-emails':
        opts.cleanTestEmails.push(
          ...next()
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        );
        break;
      case '--backup-dir':
        opts.backupDir = next().trim();
        break;
      case '--confirm-project':
        opts.confirmProject = next().trim();
        break;
      case '--confirm-plan-hash':
        opts.confirmPlanHash = next().trim().toLowerCase();
        break;
      case '--resume':
        opts.resume = true;
        break;
      case '--quiesce-cloud-run':
        opts.quiesceCloudRun = true;
        break;
      case '--acknowledge-no-active-writers':
        opts.acknowledgeNoActiveWriters = true;
        break;
      case '--allow-stale-backup':
        opts.allowStaleBackup = true;
        break;
      case '--help':
      case '-h':
        printUsage(0);
        break;
      default:
        throw new Error(`Opção desconhecida: '${arg}'. Use --help para ver as opções.`);
    }
  }

  if (opts.backupOnly === opts.executeClean) {
    throw new Error('Especifique exatamente UM modo: --backup-only OU --execute-clean.');
  }

  return opts;
}

// ============================================================================
// Utilitários de Segurança e Sanitização
// ============================================================================

export function isValidCanonicalUid(id) {
  if (!id || typeof id !== 'string') return false;
  const s = id.trim();
  if (s.length < 20 || s.length > 128) return false;
  if (s.includes('@') || s.includes(' ')) return false;
  const lower = s.toLowerCase();
  if (
    lower.startsWith('usr-') ||
    lower.startsWith('st-') ||
    lower.startsWith('tutor-') ||
    lower.startsWith('user-') ||
    lower.startsWith('student-') ||
    lower.startsWith('teacher-') ||
    lower.startsWith('test-') ||
    lower.startsWith('mock-') ||
    lower.startsWith('demo-')
  ) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(s);
}

export function isTestEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.toLowerCase().trim();
  if (!clean) return false;
  if (PROTECTED_ADMIN_EMAILS.has(clean)) return false;
  if (TEST_EMAIL_DOMAINS.some((d) => clean.endsWith(d))) return true;
  const local = clean.split('@')[0] || '';
  if (
    local.startsWith('test+') ||
    local.startsWith('fake_') ||
    local.startsWith('dummy_') ||
    local === 'test' ||
    local === 'fake'
  ) {
    return true;
  }
  return false;
}

export function isTestIdentifier(id) {
  if (!id || typeof id !== 'string') return false;
  const lower = id.toLowerCase().trim();
  return (
    lower.startsWith('test-') ||
    lower.startsWith('test_') ||
    lower.startsWith('diag-') ||
    lower.startsWith('diag_') ||
    lower.startsWith('probe-') ||
    lower.startsWith('probe_') ||
    lower.startsWith('mock-') ||
    lower.startsWith('mock_') ||
    lower.startsWith('seed-') ||
    lower.startsWith('seed_') ||
    lower.includes('connectivity_check')
  );
}

export function sanitizeCredentialsDeep(value) {
  let redactedCount = 0;
  function walk(node) {
    if (node === null || node === undefined) return node;
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        if (SENSITIVE_FIELD_NAMES.has(k) || SENSITIVE_FIELD_NAMES.has(k.toLowerCase())) {
          redactedCount++;
          out[k] = '[REDACTED]';
          continue;
        }
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  }
  return { sanitized: walk(value), redactedCount };
}

export function sanitizeAuthUserRecord(rawUser) {
  let customClaims = {};
  if (rawUser?.customAttributes) {
    try {
      customClaims = JSON.parse(rawUser.customAttributes);
    } catch {
      customClaims = {};
    }
  }
  const providers = Array.isArray(rawUser?.providerUserInfo)
    ? rawUser.providerUserInfo.map((p) => p?.providerId).filter(Boolean)
    : [];

  return {
    uid: String(rawUser?.localId || rawUser?.uid || ''),
    email: rawUser?.email ? String(rawUser.email).toLowerCase().trim() : null,
    emailVerified: Boolean(rawUser?.emailVerified),
    displayName: rawUser?.displayName ? String(rawUser.displayName) : null,
    disabled: Boolean(rawUser?.disabled),
    customClaims,
    providers,
    createdAt: rawUser?.createdAt || null,
    lastLoginAt: rawUser?.lastLoginAt || null,
  };
}

// Conversão Firestore REST Value <-> JS Value (para inspeção sem perder tipos no backup bruto)
export function decodeFirestoreValue(val) {
  if (!val || typeof val !== 'object') return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('bytesValue' in val) return val.bytesValue;
  if ('referenceValue' in val) return val.referenceValue;
  if ('geoPointValue' in val) return val.geoPointValue;
  if ('arrayValue' in val) {
    const arr = val.arrayValue?.values;
    return Array.isArray(arr) ? arr.map(decodeFirestoreValue) : [];
  }
  if ('mapValue' in val) {
    const fields = val.mapValue?.fields || {};
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

export function decodeFirestoreDocFields(doc) {
  const fields = doc?.fields || {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  return out;
}

export function encodeFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val) && Number.isSafeInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(encodeFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function sanitizeRawFirestoreFieldsForBackup(rawFields) {
  if (!rawFields || typeof rawFields !== 'object') return rawFields;
  let redactedCount = 0;
  function walkMap(fieldsObj) {
    const copy = {};
    for (const [k, v] of Object.entries(fieldsObj || {})) {
      if (SENSITIVE_FIELD_NAMES.has(k) || SENSITIVE_FIELD_NAMES.has(k.toLowerCase())) {
        redactedCount++;
        copy[k] = { stringValue: '[REDACTED]' };
        continue;
      }
      copy[k] = walkVal(v);
    }
    return copy;
  }
  function walkVal(val) {
    if (!val || typeof val !== 'object') return val;
    if (val.mapValue && val.mapValue.fields) {
      return { mapValue: { fields: walkMap(val.mapValue.fields) } };
    }
    if (val.arrayValue && Array.isArray(val.arrayValue.values)) {
      return { arrayValue: { values: val.arrayValue.values.map(walkVal) } };
    }
    return val;
  }
  return { fields: walkMap(rawFields), redactedCount };
}

function sha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ============================================================================
// Wrappers gcloud / REST (sem expor tokens)
// ============================================================================

function runGcloud(args, { allowFail = false } = {}) {
  try {
    return execFileSync('gcloud', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    if (allowFail) return '';
    const stderr = err?.stderr ? String(err.stderr).trim() : '';
    throw new Error(`Falha ao executar gcloud ${args.join(' ')}: ${stderr || err.message}`);
  }
}

class GcloudTokenProvider {
  constructor() {
    this.token = '';
    this.fetchedAt = 0;
  }
  getToken() {
    const now = Date.now();
    // Renova token a cada 40 minutos em execuções longas
    if (!this.token || now - this.fetchedAt > 40 * 60 * 1000) {
      const tok = runGcloud(['auth', 'print-access-token']);
      if (!tok) {
        throw new Error('Não foi possível obter access token do gcloud. Execute: gcloud auth login');
      }
      this.token = tok;
      this.fetchedAt = now;
    }
    return this.token;
  }
  invalidate() {
    this.token = '';
    this.fetchedAt = 0;
  }
}

async function googleApiFetch(url, { method = 'GET', body, tokenProvider, projectId, retries = 3 } = {}) {
  let attempt = 0;
  while (true) {
    attempt++;
    const token = tokenProvider.getToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      'X-Goog-User-Project': projectId,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && attempt <= 2) {
      tokenProvider.invalidate();
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt <= retries) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
      continue;
    }

    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { rawText: text };
    }
    return { ok: res.ok, status: res.status, data: parsed };
  }
}

// ============================================================================
// Descoberta de Projeto, Bancos e Serviços Ativos
// ============================================================================

function detectTargetProject(opts) {
  let projectId = opts.project;
  let source = 'flag --project';

  if (!projectId) {
    projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.DEVSHELL_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      runGcloud(['config', 'get-value', 'project'], { allowFail: true });
    source = 'ambiente / gcloud config';
  }

  if (!projectId || projectId === '(unset)') {
    projectId = EXPECTED_PROJECT_ID;
    source = 'padrão do projeto';
  }

  if (FORBIDDEN_LEGACY_PROJECT_IDS.has(projectId)) {
    throw new Error(
      `BLOQUEIO DE SEGURANÇA: Projeto legado '${projectId}' é estritamente proibido.`
    );
  }

  if (projectId !== EXPECTED_PROJECT_ID && !opts.allowNonDefaultProject) {
    throw new Error(
      `Projeto detectado '${projectId}' (via ${source}) difere do projeto esperado '${EXPECTED_PROJECT_ID}'. ` +
        `Passe '--project ${EXPECTED_PROJECT_ID}' ou '--allow-non-default-project' se intencional.`
    );
  }

  const activeAccount = runGcloud(
    ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'],
    { allowFail: true }
  );
  if (!activeAccount) {
    throw new Error('Nenhuma conta ativa no gcloud. Execute "gcloud auth login" no Cloud Shell.');
  }

  const projJsonRaw = runGcloud([
    'projects',
    'describe',
    projectId,
    '--format=json(projectId,projectNumber,name,lifecycleState)',
  ]);
  const projInfo = JSON.parse(projJsonRaw);
  if (projInfo.lifecycleState !== 'ACTIVE') {
    throw new Error(`Projeto '${projectId}' não está ACTIVE (estado: ${projInfo.lifecycleState}).`);
  }

  // Verificar se existe firebase-applet-config.json local apenas para relatório comparativo
  let appletConfigWarning = null;
  const localConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(localConfigPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
      if (cfg.firestoreDatabaseId && cfg.firestoreDatabaseId !== TARGET_DATABASE_ID) {
        appletConfigWarning =
          `Nota: firebase-applet-config.json aponta firestoreDatabaseId='${cfg.firestoreDatabaseId}', ` +
          `mas conforme ARCH.2 / HOTFIX 4B.18 o banco canônico alvo desta operação é '${TARGET_DATABASE_ID}'.`;
      }
    } catch {}
  }

  // Listar bancos Firestore existentes no projeto
  const dbsRaw = runGcloud(
    ['firestore', 'databases', 'list', `--project=${projectId}`, '--format=json'],
    { allowFail: true }
  );
  let databases = [];
  if (dbsRaw) {
    try {
      const parsed = JSON.parse(dbsRaw);
      databases = (Array.isArray(parsed) ? parsed : []).map((d) => ({
        name: d.name,
        id: String(d.name || '').split('/').pop(),
        locationId: d.locationId,
        type: d.type,
      }));
    } catch {}
  }

  const hasDefaultDb = databases.some((d) => d.id === '(default)');
  if (databases.length > 0 && !hasDefaultDb) {
    throw new Error(`Banco Firestore '(default)' não encontrado no projeto '${projectId}'.`);
  }

  return {
    projectId: projInfo.projectId,
    projectNumber: String(projInfo.projectNumber || ''),
    projectName: String(projInfo.name || ''),
    activeAccount,
    databases,
    appletConfigWarning,
  };
}

function inspectActiveWriters(projectId) {
  const cloudRunRaw = runGcloud(
    ['run', 'services', 'list', `--project=${projectId}`, '--format=json'],
    { allowFail: true }
  );
  const functionsRaw = runGcloud(
    ['functions', 'list', `--project=${projectId}`, '--format=json'],
    { allowFail: true }
  );
  const schedulerRaw = runGcloud(
    ['scheduler', 'jobs', 'list', `--project=${projectId}`, '--format=json'],
    { allowFail: true }
  );

  const cloudRunServices = [];
  if (cloudRunRaw) {
    try {
      const list = JSON.parse(cloudRunRaw);
      for (const svc of Array.isArray(list) ? list : []) {
        const name = svc?.metadata?.name || '';
        const region =
          svc?.metadata?.labels?.['cloud.googleapis.com/location'] ||
          svc?.metadata?.annotations?.['run.googleapis.com/location'] ||
          '';
        const annotations = svc?.spec?.template?.metadata?.annotations || {};
        const envVars = {};
        const containers = svc?.spec?.template?.spec?.containers || [];
        for (const c of containers) {
          for (const e of c.env || []) {
            if (e.name && e.value !== undefined) {
              envVars[e.name] = e.value;
            }
          }
        }
        const maxScale = Number(annotations['autoscaling.knative.dev/maxScale'] ?? -1);
        const minScale = Number(annotations['autoscaling.knative.dev/minScale'] ?? 0);
        const hasDiagnosticVar = 'DIAGNOSTIC_ONLY' in envVars;
        const diagnosticOnlyValue = hasDiagnosticVar ? envVars.DIAGNOSTIC_ONLY : null;
        const isDiagnosticOnly = diagnosticOnlyValue === 'true';
        cloudRunServices.push({
          name,
          region,
          url: svc?.status?.url || '',
          minScale,
          maxScale,
          hasDiagnosticVar,
          diagnosticOnlyValue,
          isDiagnosticOnly,
          potentiallyActiveBusinessWriter: !isDiagnosticOnly,
        });
      }
    } catch {}
  }

  const cloudFunctions = [];
  if (functionsRaw) {
    try {
      const list = JSON.parse(functionsRaw);
      for (const fn of Array.isArray(list) ? list : []) {
        cloudFunctions.push({
          name: fn?.name || '',
          state: fn?.state || fn?.status || '',
        });
      }
    } catch {}
  }

  const schedulerJobs = [];
  if (schedulerRaw) {
    try {
      const list = JSON.parse(schedulerRaw);
      for (const job of Array.isArray(list) ? list : []) {
        schedulerJobs.push({
          name: job?.name || '',
          state: job?.state || '',
        });
      }
    } catch {}
  }

  const activeBusinessRun = cloudRunServices.filter((s) => s.potentiallyActiveBusinessWriter);
  const enabledSchedulers = schedulerJobs.filter((j) => String(j.state).toUpperCase() === 'ENABLED');

  return {
    cloudRunServices,
    cloudFunctions,
    schedulerJobs,
    hasActiveBusinessWriters:
      activeBusinessRun.length > 0 || cloudFunctions.length > 0 || enabledSchedulers.length > 0,
    activeBusinessRun,
    enabledSchedulers,
  };
}

// ============================================================================
// Listagem Segura de Firebase Auth (zero exposição de credenciais)
// ============================================================================

async function listFirebaseAuthUsersSanitized(projectId, tokenProvider) {
  const users = [];
  let nextPageToken = '';

  while (true) {
    const qs = new URLSearchParams({ maxResults: '500' });
    if (nextPageToken) qs.set('nextPageToken', nextPageToken);
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:batchGet?${qs.toString()}`;
    const res = await googleApiFetch(url, { method: 'GET', tokenProvider, projectId });

    if (!res.ok) {
      const msg = res.data?.error?.message || `HTTP ${res.status}`;
      throw new Error(
        `Falha ao listar usuários do Firebase Auth (${msg}). ` +
          `Verifique se a API identitytoolkit.googleapis.com está ativa e se você possui roles/firebaseauth.viewer.`
      );
    }

    const batch = Array.isArray(res.data?.users) ? res.data.users : [];
    for (const raw of batch) {
      // Sanitização imediata em memória: nunca persiste passwordHash, salt ou tokens
      users.push(sanitizeAuthUserRecord(raw));
    }

    if (res.data?.nextPageToken) {
      nextPageToken = res.data.nextPageToken;
    } else {
      break;
    }
  }

  return users;
}

// ============================================================================
// Varredura Recursiva Completa do Firestore (default)
// ============================================================================

async function listCollectionIds(parentResourceName, tokenProvider, projectId) {
  const ids = [];
  let pageToken = '';
  while (true) {
    const url = `https://firestore.googleapis.com/v1/${parentResourceName}:listCollectionIds`;
    const body = { pageSize: 200 };
    if (pageToken) body.pageToken = pageToken;
    const res = await googleApiFetch(url, { method: 'POST', body, tokenProvider, projectId });
    if (!res.ok) {
      const msg = res.data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Falha ao listar coleções em '${parentResourceName}': ${msg}`);
    }
    if (Array.isArray(res.data?.collectionIds)) {
      ids.push(...res.data.collectionIds);
    }
    if (res.data?.nextPageToken) {
      pageToken = res.data.nextPageToken;
    } else {
      break;
    }
  }
  return ids;
}

async function listDocumentsInCollection(parentResourceName, collectionId, tokenProvider, projectId) {
  const docs = [];
  let pageToken = '';
  while (true) {
    const qs = new URLSearchParams({ pageSize: '100', showMissing: 'true' });
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `https://firestore.googleapis.com/v1/${parentResourceName}/${encodeURIComponent(collectionId)}?${qs.toString()}`;
    const res = await googleApiFetch(url, { method: 'GET', tokenProvider, projectId });
    if (!res.ok) {
      const msg = res.data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Falha ao listar documentos de '${parentResourceName}/${collectionId}': ${msg}`);
    }
    if (Array.isArray(res.data?.documents)) {
      docs.push(...res.data.documents);
    }
    if (res.data?.nextPageToken) {
      pageToken = res.data.nextPageToken;
    } else {
      break;
    }
  }
  return docs;
}

async function exportAllFirestoreDocuments(projectId, tokenProvider) {
  const rootParent = `projects/${projectId}/databases/${TARGET_DATABASE_ID}/documents`;
  const exportedDocs = [];
  const collectionCounts = {};
  let redactedFieldsTotal = 0;

  async function walkCollection(parentResourceName, collectionId, relativeParent) {
    const rawDocs = await listDocumentsInCollection(parentResourceName, collectionId, tokenProvider, projectId);
    const colPath = relativeParent ? `${relativeParent}/${collectionId}` : collectionId;
    if (!collectionCounts[colPath]) collectionCounts[colPath] = 0;

    for (const rawDoc of rawDocs) {
      const fullName = rawDoc.name; // projects/.../documents/col/docId
      const relPath = fullName.slice(rootParent.length + 1);
      const segments = relPath.split('/');
      const docId = segments[segments.length - 1];
      const isVirtualMissingDoc = !rawDoc.createTime && !rawDoc.fields;

      if (!isVirtualMissingDoc) {
        collectionCounts[colPath] = (collectionCounts[colPath] || 0) + 1;
        const decoded = decodeFirestoreDocFields(rawDoc);
        const { sanitized: safeDecoded, redactedCount: r1 } = sanitizeCredentialsDeep(decoded);
        const { fields: safeRawFields, redactedCount: r2 } = sanitizeRawFirestoreFieldsForBackup(
          rawDoc.fields || {}
        );
        redactedFieldsTotal += Math.max(r1, r2);

        exportedDocs.push({
          name: fullName,
          path: relPath,
          rootCollection: segments[0],
          collectionPath: colPath,
          docId,
          depth: Math.floor(segments.length / 2),
          createTime: rawDoc.createTime || null,
          updateTime: rawDoc.updateTime || null,
          data: safeDecoded,
          rawFields: safeRawFields,
        });
      }

      // Sempre verificar subcoleções (inclusive em documentos virtuais/missing)
      const subCols = await listCollectionIds(fullName, tokenProvider, projectId);
      for (const subCol of subCols) {
        await walkCollection(fullName, subCol, relPath);
      }
    }
  }

  const rootCollections = await listCollectionIds(rootParent, tokenProvider, projectId);
  for (const rootCol of rootCollections) {
    await walkCollection(rootParent, rootCol, '');
  }

  return {
    rootCollections,
    exportedDocs,
    collectionCounts,
    redactedFieldsTotal,
  };
}

// ============================================================================
// Motor Determinístico de Classificação (Preservar vs Excluir vs Sanitizar)
// ============================================================================

export function classifyFirestoreInventory({
  exportedDocs,
  authUsers,
  cleanTestUids = [],
  cleanTestEmails = [],
  fullTestReset = false,
}) {
  const authByUid = new Map();
  const authByEmail = new Map();
  const adminUids = new Set();
  const adminEmails = new Set([...PROTECTED_ADMIN_EMAILS]);

  for (const u of authUsers || []) {
    if (!u?.uid) continue;
    authByUid.set(u.uid, u);
    const em = (u.email || '').toLowerCase().trim();
    if (em) authByEmail.set(em, u);
    if (
      u.customClaims?.role === 'admin' ||
      u.customClaims?.admin === true ||
      PROTECTED_ADMIN_EMAILS.has(em)
    ) {
      adminUids.add(u.uid);
      if (em) adminEmails.add(em);
    }
  }

  // Contas marcadas pelo operador como contas de QA/teste (Auth preservado, dados Firestore limpos)
  const operatorCleanUids = new Set(cleanTestUids);
  for (const em of cleanTestEmails) {
    const cleanEm = em.toLowerCase().trim();
    if (adminEmails.has(cleanEm)) {
      throw new Error(`BLOQUEIO: Não é permitido marcar conta administrativa '${cleanEm}' para limpeza.`);
    }
    const found = authByEmail.get(cleanEm);
    if (found?.uid) operatorCleanUids.add(found.uid);
  }
  for (const uid of operatorCleanUids) {
    if (adminUids.has(uid)) {
      throw new Error(`BLOQUEIO: Não é permitido marcar UID administrativo '${uid}' para limpeza.`);
    }
  }

  // Índice auxiliar de subcoleções existentes por usuário (para verificar legado seguro)
  const userSubcollectionsMap = new Map(); // uid -> Set(subcollectionName)
  for (const doc of exportedDocs) {
    const segs = doc.path.split('/');
    if (segs[0] === 'users' && segs.length >= 4) {
      const uid = segs[1];
      const subCol = segs[2];
      if (!userSubcollectionsMap.has(uid)) userSubcollectionsMap.set(uid, new Set());
      userSubcollectionsMap.get(uid).add(subCol);
    }
  }

  // Determinar quais UIDs de Auth têm dados Firestore preservados
  // No modo ARCH.2G.2 (fullTestReset=true), todos os usuários Auth (UIDs, claims) são 100% preservados
  // no Firebase Authentication, mas seus DADOS DE TESTE no Firestore (exceto identidade mínima de admin
  // em users/{adminUid}) entram no reset completo.
  const preservedUserUids = new Set();
  const testUserUids = new Set([...operatorCleanUids]);

  for (const u of authUsers || []) {
    if (adminUids.has(u.uid)) {
      preservedUserUids.add(u.uid);
      continue;
    }
    if (fullTestReset) {
      testUserUids.add(u.uid);
    } else if (operatorCleanUids.has(u.uid) || isTestEmail(u.email)) {
      testUserUids.add(u.uid);
    } else {
      preservedUserUids.add(u.uid);
    }
  }

  const actions = [];
  const summary = {
    resetScope: fullTestReset ? 'arch.2g.2-full-test-reset' : 'arch.2g.1-selective',
    totalDocsScanned: exportedDocs.length,
    preserveCount: 0,
    deleteDocCount: 0,
    sanitizeFieldsCount: 0,
    reviewCount: 0,
    byRootCollection: {},
  };

  function recordAction(doc, actionType, reason, extra = {}) {
    const entry = {
      path: doc.path,
      name: doc.name,
      rootCollection: doc.rootCollection,
      docId: doc.docId,
      updateTime: doc.updateTime,
      action: actionType, // PRESERVE | DELETE_DOC | SANITIZE_FIELDS | REVIEW
      reason,
      ...extra,
    };
    actions.push(entry);
    if (!summary.byRootCollection[doc.rootCollection]) {
      summary.byRootCollection[doc.rootCollection] = {
        PRESERVE: 0,
        DELETE_DOC: 0,
        SANITIZE_FIELDS: 0,
        REVIEW: 0,
      };
    }
    summary.byRootCollection[doc.rootCollection][actionType]++;
    if (actionType === 'PRESERVE') summary.preserveCount++;
    else if (actionType === 'DELETE_DOC') summary.deleteDocCount++;
    else if (actionType === 'SANITIZE_FIELDS') summary.sanitizeFieldsCount++;
    else if (actionType === 'REVIEW') summary.reviewCount++;
  }

  const isDocTestMarked = (data, docId) => {
    if (!data || typeof data !== 'object') return isTestIdentifier(docId);
    if (data.isTest === true || data.isLocalJsonRecord === true) return true;
    if (data.origin === 'local_json' || data.source === 'app_db.json') return true;
    const emails = [data.email, data.studentEmail, data.teacherEmail, data.senderEmail, data.recipientEmail];
    if (emails.some((e) => isTestEmail(e))) return true;
    if (isTestIdentifier(docId)) return true;
    return false;
  };

  // Ordenar: subcoleções/folhas antes de pais para DELETE ficar seguro em qualquer ordem
  const sortedDocs = [...exportedDocs].sort((a, b) => b.depth - a.depth || a.path.localeCompare(b.path));

  for (const doc of sortedDocs) {
    const segs = doc.path.split('/');
    const rootCol = segs[0];
    const data = doc.data || {};

    // 0. Trava de manutenção (nunca entra no plano como deleção)
    if (doc.path === MAINTENANCE_LOCK_DOC_PATH || rootCol === '_maintenance_locks') {
      recordAction(doc, 'PRESERVE', 'Trava operacional de manutenção');
      continue;
    }

    // 1. Coleções descontinuadas / diagnóstico / locks efêmeros
    if (DISCONTINUED_COLLECTIONS.has(rootCol)) {
      recordAction(doc, 'DELETE_DOC', `Coleção descontinuada/diagnóstico (${rootCol})`);
      continue;
    }

    // 2. Coleções estruturais preservadas
    if (STRUCTURAL_PRESERVED_COLLECTIONS.has(rootCol)) {
      recordAction(doc, 'PRESERVE', `Coleção estrutural do sistema (${rootCol})`);
      continue;
    }

    // 3. app_state/*
    if (rootCol === 'app_state' && segs.length === 2) {
      const docId = segs[1];
      if (PROTECTED_APP_STATE_DOCS.has(docId)) {
        recordAction(doc, 'PRESERVE', `Configuração estrutural/administrativa protegida (app_state/${docId})`);
        continue;
      }
      if (DELETABLE_APP_STATE_DOCS.has(docId) || isTestIdentifier(docId)) {
        recordAction(doc, 'DELETE_DOC', `Documento legado/cache de app_state (${doc.path})`);
        continue;
      }
      if (docId === 'main_data') {
        if (fullTestReset) {
          // ARCH.2G.2: remover TODOS os resíduos de estado/teste, mantendo apenas landingContent, spotifyPlaylists, updatedAt
          const fieldsToRemove = Object.keys(data).filter(
            (f) => !FULL_RESET_STRUCTURAL_MAIN_DATA_FIELDS.has(f)
          );
          if (fieldsToRemove.length > 0) {
            recordAction(
              doc,
              'SANITIZE_FIELDS',
              'ARCH.2G.2: Eliminar todos os resíduos de estado/teste em app_state/main_data preservando apenas landingContent e spotifyPlaylists',
              {
                removeFields: fieldsToRemove,
                preserveFields: Object.keys(data).filter((k) => FULL_RESET_STRUCTURAL_MAIN_DATA_FIELDS.has(k)),
              }
            );
          } else {
            recordAction(doc, 'PRESERVE', 'app_state/main_data já contém apenas campos estruturais essenciais');
          }
        } else {
          const fieldsToRemove = LEGACY_MAIN_DATA_FIELDS.filter((f) => f in data);
          if (fieldsToRemove.length > 0) {
            recordAction(doc, 'SANITIZE_FIELDS', 'Remover caches legados de usuários/alunos preservando landingContent/configurações estruturais', {
              removeFields: fieldsToRemove,
              preserveFields: Object.keys(data).filter((k) => STRUCTURAL_MAIN_DATA_FIELDS.has(k)),
            });
          } else {
            recordAction(doc, 'PRESERVE', 'app_state/main_data já contém apenas campos estruturais');
          }
        }
        continue;
      }
      if (docId === 'routines') {
        const fieldsToRemove = fullTestReset
          ? Object.keys(data).filter((f) => !FULL_RESET_STRUCTURAL_ROUTINES_FIELDS.has(f))
          : LEGACY_ROUTINES_FIELDS.filter((f) => f in data);
        if (fieldsToRemove.length > 0) {
          recordAction(doc, 'SANITIZE_FIELDS', 'Remover mapas de rotinas de alunos preservando apenas template estrutural routinesByDay', {
            removeFields: fieldsToRemove,
            preserveFields: ['routinesByDay', 'updatedAt'].filter((k) => k in data),
          });
        } else {
          recordAction(doc, 'PRESERVE', 'app_state/routines já contém apenas template estrutural');
        }
        continue;
      }
      if (docId === 'tutors') {
        const currentTeachers = Array.isArray(data.teachers) ? data.teachers : [];
        const preservedAdminTeachers = currentTeachers.filter((t) => {
          if (!t || t.role !== 'admin') return false;
          const uid = String(t.uid || t.id || '').trim();
          const em = String(t.email || '').toLowerCase().trim();
          return adminUids.has(uid) || adminEmails.has(em);
        });
        const extraFieldsToRemove = fullTestReset
          ? Object.keys(data).filter((f) => f !== 'teachers' && f !== 'updatedAt')
          : ['tutorsList', 'deletedTutorEmails', 'deletedTutorIds'].filter((f) => f in data);
        const needsSanitize =
          extraFieldsToRemove.length > 0 ||
          preservedAdminTeachers.length !== currentTeachers.length;

        if (needsSanitize) {
          recordAction(doc, 'SANITIZE_FIELDS', 'Remover listas e metadados de tutores de teste preservando apenas registros administrativos canônicos', {
            removeFields: extraFieldsToRemove,
            updateFields: {
              teachers: preservedAdminTeachers,
              updatedAt: new Date().toISOString(),
            },
          });
        } else {
          recordAction(doc, 'PRESERVE', 'app_state/tutors já contém apenas registros administrativos');
        }
        continue;
      }
      if (docId === 'lessons') {
        if (fullTestReset) {
          const extraFieldsToRemove = Object.keys(data).filter(
            (f) => f !== 'contractedLessons' && f !== 'updatedAt'
          );
          const hasContractedEntries =
            data.contractedLessons &&
            typeof data.contractedLessons === 'object' &&
            Object.keys(data.contractedLessons).length > 0;
          if (extraFieldsToRemove.length > 0 || hasContractedEntries) {
            recordAction(
              doc,
              'SANITIZE_FIELDS',
              'ARCH.2G.2: Zerar contractedLessons de teste e remover resíduos legados de aulas em app_state/lessons',
              {
                removeFields: extraFieldsToRemove,
                updateFields: {
                  contractedLessons: {},
                  updatedAt: new Date().toISOString(),
                },
              }
            );
          } else {
            recordAction(doc, 'PRESERVE', 'app_state/lessons já está zerado');
          }
        } else {
          const contracted = data.contractedLessons && typeof data.contractedLessons === 'object' ? data.contractedLessons : null;
          let filteredContracted = null;
          let contractedPruned = false;
          if (contracted) {
            filteredContracted = {};
            for (const [k, v] of Object.entries(contracted)) {
              const lk = k.toLowerCase().trim();
              const authMatch = authByEmail.get(lk);
              if (authMatch && preservedUserUids.has(authMatch.uid) && !isTestEmail(lk)) {
                filteredContracted[k] = v;
              } else {
                contractedPruned = true;
              }
            }
          }
          const fieldsToRemove = LEGACY_LESSONS_FIELDS.filter((f) => f in data);
          if (fieldsToRemove.length > 0 || contractedPruned) {
            recordAction(doc, 'SANITIZE_FIELDS', 'Remover arrays legados de aulas e créditos órfãos/teste em app_state/lessons', {
              removeFields: fieldsToRemove,
              ...(contractedPruned ? { updateFields: { contractedLessons: filteredContracted, updatedAt: new Date().toISOString() } } : {}),
            });
          } else {
            recordAction(doc, 'PRESERVE', 'app_state/lessons já está limpo');
          }
        }
        continue;
      }
      recordAction(doc, 'REVIEW', `Documento desconhecido em app_state/${docId} — requer revisão do operador`);
      continue;
    }

    // 4. users/{uid} e subcoleções
    if (rootCol === 'users') {
      const userDocId = segs[1];
      const userEmail = String(data.email || '').toLowerCase().trim();
      const authRecord = authByUid.get(userDocId);
      const authEmail = String(authRecord?.email || '').toLowerCase().trim();
      const isVerifiedAdminUid =
        adminUids.has(userDocId) ||
        (Boolean(authRecord) && adminEmails.has(authEmail));
      const isAdminDoc = fullTestReset
        ? isVerifiedAdminUid
        : isVerifiedAdminUid || adminEmails.has(userEmail) || data.role === 'admin';

      // Documento raiz users/{userDocId}
      if (segs.length === 2) {
        if (fullTestReset) {
          if (isVerifiedAdminUid && isValidCanonicalUid(userDocId)) {
            const removeFields = Object.keys(data).filter(
              (f) => !FULL_RESET_ADMIN_ROOT_KEEP_FIELDS.has(f)
            );
            const needsRoleRepair = data.role !== 'admin';
            if (removeFields.length > 0 || needsRoleRepair) {
              recordAction(
                doc,
                'SANITIZE_FIELDS',
                'ARCH.2G.2: Preservar identidade mínima do administrador e remover campos de teste do perfil Firestore',
                {
                  removeFields,
                  ...(needsRoleRepair
                    ? {
                        updateFields: {
                          role: 'admin',
                          updatedAt: new Date().toISOString(),
                        },
                      }
                    : {}),
                  preserveFields: Object.keys(data).filter((k) => FULL_RESET_ADMIN_ROOT_KEEP_FIELDS.has(k)),
                }
              );
            } else {
              recordAction(doc, 'PRESERVE', 'Identidade mínima canônica de administrador');
            }
          } else {
            recordAction(
              doc,
              'DELETE_DOC',
              'ARCH.2G.2: Limpar perfil Firestore de teste/usuário real preservando conta no Firebase Auth'
            );
          }
          continue;
        }

        if (isAdminDoc && isValidCanonicalUid(userDocId) && authByUid.has(userDocId)) {
          const legacyFields = LEGACY_USER_ROOT_FIELDS_SAFE.filter((f) => f in data);
          if (legacyFields.length > 0) {
            recordAction(doc, 'SANITIZE_FIELDS', 'Preservar administrador e remover campos legados/sensíveis da raiz', {
              removeFields: legacyFields,
            });
          } else {
            recordAction(doc, 'PRESERVE', 'Perfil canônico de administrador');
          }
          continue;
        }

        if (!isValidCanonicalUid(userDocId) || isDocTestMarked(data, userDocId)) {
          recordAction(doc, 'DELETE_DOC', 'Usuário legado não-canônico ou registro de teste');
          continue;
        }

        if (testUserUids.has(userDocId)) {
          recordAction(doc, 'DELETE_DOC', 'Dados Firestore de conta marcada como teste (Auth preservado)');
          continue;
        }

        if (!authByUid.has(userDocId)) {
          recordAction(doc, 'DELETE_DOC', 'Documento órfão em users/ sem conta correspondente no Firebase Auth');
          continue;
        }

        // Usuário legítimo existente no Auth
        const subCols = userSubcollectionsMap.get(userDocId) || new Set();
        const legacyFields = LEGACY_USER_ROOT_FIELDS_SAFE.filter((f) => f in data);
        if ('vocabulary' in data && subCols.has('vocabulary')) legacyFields.push('vocabulary');
        if ('studentJournal' in data && (subCols.has('activity_journal') || subCols.has('journal'))) {
          legacyFields.push('studentJournal');
        }
        if ('dailyJournalEntries' in data && subCols.has('journal')) {
          legacyFields.push('dailyJournalEntries');
        }
        if (legacyFields.length > 0) {
          recordAction(doc, 'SANITIZE_FIELDS', 'Preservar usuário legítimo e remover espelhos legados já consolidados', {
            removeFields: Array.from(new Set(legacyFields)),
          });
        } else {
          recordAction(doc, 'PRESERVE', 'Usuário canônico autenticado no Firebase Auth');
        }
        continue;
      }

      // Subcoleções de users/{userDocId}/{subCol}/... (incluindo rotinas, Journal, Dictionary, homework, session_notes, lessons)
      if (segs.length >= 4) {
        const subCol = segs[2];
        const subDocId = segs[3];

        if (fullTestReset) {
          recordAction(
            doc,
            'DELETE_DOC',
            `ARCH.2G.2: Remover dados de teste em users/${userDocId}/${subCol} (Auth preservado)`
          );
          continue;
        }

        const parentIsDeletable =
          !isAdminDoc &&
          (!isValidCanonicalUid(userDocId) ||
            !authByUid.has(userDocId) ||
            testUserUids.has(userDocId));

        if (parentIsDeletable) {
          recordAction(doc, 'DELETE_DOC', `Subcoleção de usuário teste/legado/órfão (users/${userDocId})`);
          continue;
        }

        if (LEGACY_USER_SUBCOLLECTIONS.has(subCol)) {
          recordAction(doc, 'DELETE_DOC', `Subcoleção legada (${subCol}) substituída por activity_journal/journal`);
          continue;
        }
        if (subCol === 'homework' && subDocId === 'current_week') {
          recordAction(doc, 'DELETE_DOC', 'Alias legado homework/current_week substituído por week-{cycle}');
          continue;
        }
        if (subCol === 'session_notes' && subDocId !== 'review_cycle') {
          recordAction(doc, 'DELETE_DOC', 'Espelho legado users/{uid}/session_notes substituído por coleção raiz session_notes');
          continue;
        }
        if (CANONICAL_USER_SUBCOLLECTIONS.has(subCol)) {
          recordAction(doc, 'PRESERVE', `Subcoleção canônica de usuário preservado (${subCol})`);
          continue;
        }
        recordAction(doc, 'REVIEW', `Subcoleção não mapeada (${doc.path})`);
        continue;
      }
    }

    // 5. Coleções de perfil/vínculo/disponibilidade por UID (tutors, tutors/*/lessons, student_assignments, teacher_availability)
    if (USER_SCOPED_COLLECTIONS.has(rootCol)) {
      if (fullTestReset) {
        recordAction(
          doc,
          'DELETE_DOC',
          `ARCH.2G.2: Limpar perfil/vínculo/disponibilidade de teste em ${doc.path} (Auth preservado)`
        );
        continue;
      }

      const targetUid = segs[1];
      if (!isValidCanonicalUid(targetUid) || isDocTestMarked(data, targetUid)) {
        recordAction(doc, 'DELETE_DOC', `Registro não-canônico ou de teste em ${rootCol}/`);
        continue;
      }
      if (testUserUids.has(targetUid)) {
        recordAction(doc, 'DELETE_DOC', `Dados de teste em ${rootCol}/ para conta QA (Auth preservado)`);
        continue;
      }
      if (!authByUid.has(targetUid)) {
        recordAction(doc, 'DELETE_DOC', `Registro órfão em ${rootCol}/ sem UID ativo no Firebase Auth`);
        continue;
      }
      recordAction(doc, 'PRESERVE', `Registro canônico em ${rootCol}/ vinculado ao Firebase Auth`);
      continue;
    }

    // 6. Coleções relacionais/eventos (lessons, session_notes, pedagogical_cache, direct_messages, lesson_insights, financial_transactions)
    if (RELATIONAL_TEST_DATA_COLLECTIONS.has(rootCol)) {
      if (fullTestReset) {
        recordAction(
          doc,
          'DELETE_DOC',
          `ARCH.2G.2: Limpar registro transacional/teste em ${rootCol}/ (inclui dados dos usuários reais)`
        );
        continue;
      }

      if (isDocTestMarked(data, doc.docId)) {
        recordAction(doc, 'DELETE_DOC', `Documento marcado como teste/local em ${rootCol}/`);
        continue;
      }
      const refUids = [
        data.studentUid,
        data.teacherUid,
        data.teacherAuthUid,
        data.nativeFriendUid,
        data.senderUid,
        data.recipientUid,
        data.uid,
      ]
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean);

      if (refUids.some((u) => testUserUids.has(u))) {
        recordAction(doc, 'DELETE_DOC', `Registro de teste vinculado a conta QA em ${rootCol}/`);
        continue;
      }
      const hasValidPreservedRef = refUids.some((u) => preservedUserUids.has(u));
      if (refUids.length > 0 && !hasValidPreservedRef) {
        recordAction(doc, 'DELETE_DOC', `Registro órfão em ${rootCol}/ sem usuário válido no Firebase Auth`);
        continue;
      }
      recordAction(doc, 'PRESERVE', `Registro canônico ativo em ${rootCol}/`);
      continue;
    }

    // 7. Coleções desconhecidas -> REVIEW (nunca apagar sem revisão explícita)
    if (isTestIdentifier(rootCol) || isTestIdentifier(doc.docId)) {
      recordAction(doc, 'DELETE_DOC', `Coleção/documento com prefixo de teste (${doc.path})`);
    } else {
      recordAction(doc, 'REVIEW', `Coleção raiz desconhecida (${rootCol}) — preservada para revisão manual`);
    }
  }

  return {
    summary,
    authSummary: {
      totalAuthUsers: (authUsers || []).length,
      adminCount: adminUids.size,
      preservedUsersCount: preservedUserUids.size,
      testAccountsDataCleanedCount: testUserUids.size,
    },
    actions,
  };
}

// ============================================================================
// Formatação de Relatório de Inventário
// ============================================================================

function buildInventoryMarkdown(projectInfo, activeWriters, authUsers, plan, restorableBackup) {
  const lines = [];
  const resetModeLabel =
    plan.summary?.resetScope === 'arch.2g.2-full-test-reset'
      ? 'ARCH.2G.2 — Reset Completo de Dados de Teste'
      : 'ARCH.2G.1 — Limpeza Seletiva';

  lines.push(`# ${resetModeLabel}: Inventário e Plano de Limpeza Firestore \`(default)\``);
  lines.push('');
  lines.push(`- **Projeto Alvo:** \`${projectInfo.projectId}\` (Número: \`${projectInfo.projectNumber}\`)`);
  lines.push(`- **Banco Alvo:** \`${TARGET_DATABASE_ID}\``);
  lines.push(`- **Escopo do Plano:** \`${plan.summary?.resetScope || 'arch.2g.2-full-test-reset'}\``);
  lines.push(`- **Operador Cloud Shell:** \`${projectInfo.activeAccount}\``);
  lines.push(`- **Gerado em:** ${new Date().toISOString()}`);
  lines.push(`- **Hash do Plano (SHA-256):** \`${plan.planHash}\``);
  lines.push('');
  if (restorableBackup?.restorable && restorableBackup?.gcsExportUri) {
    lines.push(`> ✅ **Backup Integral Restaurável Verificado:** \`${restorableBackup.gcsExportUri}\``);
    lines.push(`> ℹ️ **Nota:** \`firestore-default-export.json\` e \`auth-users-sanitized.json\` têm credenciais redactadas (\`[REDACTED]\`) e servem **apenas** para auditoria offline; para restauração integral utilize exclusivamente \`gcloud firestore import "${restorableBackup.gcsExportUri}" --project="${projectInfo.projectId}" --database="(default)"\`.`);
  } else {
    lines.push('> ⚠️ **MODO SOMENTE AUDITORIA (SEM BACKUP INTEGRAL NO GCS):** Nenhum export gerenciado no GCS foi realizado (`--allow-audit-only-without-gcs`). O arquivo `firestore-default-export.json` é sanitizado e **NÃO** é backup restaurável. A execução `--execute-clean` está **BLOQUEADA** para este diretório.');
  }
  lines.push('');
  if (projectInfo.appletConfigWarning) {
    lines.push(`> ⚠️ ${projectInfo.appletConfigWarning}`);
    lines.push('');
  }
  lines.push('## 1. Resumo Executivo');
  lines.push('');
  lines.push(`| Categoria | Quantidade | Ação |`);
  lines.push(`|---|---:|---|`);
  lines.push(`| Usuários Firebase Auth | ${authUsers.length} | **PRESERVAR 100%** (UIDs e custom claims intactos) |`);
  lines.push(`| Documentos Firestore Preservados | ${plan.summary.preserveCount} | **PRESERVAR** |`);
  lines.push(`| Documentos a Sanitizar (in-place) | ${plan.summary.sanitizeFieldsCount} | **SANITIZAR IN-PLACE** |`);
  lines.push(`| Documentos de Teste/Resíduos a Excluir | ${plan.summary.deleteDocCount} | **EXCLUIR** |`);
  lines.push(`| Documentos em Revisão Manual | ${plan.summary.reviewCount} | **IGNORAR (revisão)** |`);
  lines.push('');
  lines.push('## 2. Serviços, Processos Ativos e Caches');
  lines.push('');
  if (activeWriters.cloudRunServices.length === 0 && activeWriters.cloudFunctions.length === 0) {
    lines.push('- Nenhum serviço Cloud Run ou Cloud Function encontrado no projeto.');
  } else {
    for (const s of activeWriters.cloudRunServices) {
      lines.push(
        `- Cloud Run \`${s.name}\` (${s.region}): \`DIAGNOSTIC_ONLY=${s.isDiagnosticOnly}\`, ` +
          `\`maxScale=${s.maxScale}\`, estado=${s.potentiallyActiveBusinessWriter ? '**ESCRITOR ATIVO (use --quiesce-cloud-run)**' : 'seguro/pausado'}`
      );
    }
    for (const fn of activeWriters.cloudFunctions) {
      lines.push(`- Cloud Function \`${fn.name}\` (estado: ${fn.state})`);
    }
  }
  lines.push('- **Atenção Anti-Restauração de `app_state`:** Antes de `--execute-clean`, encerre também qualquer servidor local (`tsx server.ts` / preview AI Studio) conectado a `itissimple-security-staging` e feche abas do navegador abertas com os 4 usuários para evitar que memória/caches locais regravem estado antigo.');
  lines.push('');
  lines.push('## 3. Usuários Firebase Authentication (Sanitizado — Zero Credenciais)');
  lines.push('');
  lines.push('| UID | E-mail | Verificado | Claims Admin | Status |');
  lines.push('|---|---|---|---|---|');
  for (const u of authUsers) {
    const isAdm = u.customClaims?.role === 'admin' || u.customClaims?.admin === true;
    lines.push(`| \`${u.uid}\` | \`${u.email || '-'}\` | ${u.emailVerified ? 'Sim' : 'Não'} | ${isAdm ? 'SIM' : 'Não'} | ${u.disabled ? 'Desabilitado' : 'Ativo'} |`);
  }
  lines.push('');
  lines.push('## 4. Detalhamento por Coleção Raiz');
  lines.push('');
  lines.push('| Coleção | Preservar | Sanitizar | Excluir | Revisão |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const [col, counts] of Object.entries(plan.summary.byRootCollection)) {
    lines.push(`| \`${col}\` | ${counts.PRESERVE} | ${counts.SANITIZE_FIELDS} | ${counts.DELETE_DOC} | ${counts.REVIEW} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ============================================================================
// Modo 1: --backup-only
// ============================================================================

async function runBackupOnly(opts) {
  console.log('\n================================================================================');
  console.log(' ARCH.2G.2 — MODO --backup-only (SOMENTE LEITURA + BACKUP INTEGRAL GCS)');
  console.log('================================================================================\n');

  if (!opts.gcsBucket && !opts.allowAuditOnlyWithoutGcs) {
    throw new Error(
      'BACKUP INTEGRAL OBRIGATÓRIO: Informe "--gcs-bucket gs://SEU-BUCKET" para executar o export nativo restaurável do Firestore (default). ' +
        'O arquivo firestore-default-export.json tem segredos redactados e NÃO serve como backup integral. ' +
        'Para mera auditoria prévia sem habilitar --execute-clean, passe --allow-audit-only-without-gcs.'
    );
  }
  if (opts.gcsBucket && !opts.gcsBucket.startsWith('gs://')) {
    throw new Error(`--gcs-bucket inválido: '${opts.gcsBucket}'. Deve começar com gs://`);
  }

  const projectInfo = detectTargetProject(opts);
  console.log(`[1/6] Projeto verificado: ${projectInfo.projectId} (#${projectInfo.projectNumber})`);
  console.log(`      Operador ativo   : ${projectInfo.activeAccount}`);
  console.log(`      Banco alvo       : ${TARGET_DATABASE_ID}`);
  if (projectInfo.appletConfigWarning) {
    console.log(`      ${projectInfo.appletConfigWarning}`);
  }

  console.log('[2/6] Inspecionando serviços Cloud Run / Functions / Scheduler...');
  const activeWriters = inspectActiveWriters(projectInfo.projectId);
  if (activeWriters.hasActiveBusinessWriters) {
    console.log(
      `      ⚠️  Detectado(s) ${activeWriters.activeBusinessRun.length} serviço(s) Cloud Run com escrita potencial ativa.`
    );
  } else {
    console.log('      ✓ Nenhum serviço de negócio ativo gravando no projeto.');
  }

  const tokenProvider = new GcloudTokenProvider();

  console.log('[3/6] Listando usuários do Firebase Authentication (modo sanitizado, sem credenciais)...');
  const authUsers = await listFirebaseAuthUsersSanitized(projectInfo.projectId, tokenProvider);
  console.log(`      ✓ ${authUsers.length} usuário(s) listados com segurança (zero hashes/tokens).`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOutDir = path.join(
    process.env.HOME || '/tmp',
    'itissimple-arch2g2-backups',
    `${projectInfo.projectId}-${ts}`
  );
  const outDir = opts.outputDir ? path.resolve(opts.outputDir) : defaultOutDir;
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });

  // Export gerenciado integral do Firestore para bucket GCS (obrigatório para habilitar --execute-clean)
  let gcsExportUri = null;
  let restorableBackup = {
    type: 'none_sanitized_audit_only',
    restorable: false,
    gcsExportUri: null,
    metadataVerifiedAt: null,
    sanitizedAuditOnlyFiles: ['firestore-default-export.json', 'auth-users-sanitized.json'],
  };

  if (opts.gcsBucket) {
    const cleanBucket = opts.gcsBucket.replace(/\/+$/, '');
    gcsExportUri = `${cleanBucket}/arch2g2-${projectInfo.projectId}-${ts}`;
    console.log(`[4/6] Executando backup integral restaurável via 'gcloud firestore export' para ${gcsExportUri}...`);
    runGcloud([
      'firestore',
      'export',
      gcsExportUri,
      `--project=${projectInfo.projectId}`,
      '--database=(default)',
    ]);
    // Verificar existência dos metadados oficiais de exportação no GCS
    const metaListing = runGcloud([
      'storage',
      'ls',
      `${gcsExportUri}/*.overall_export_metadata`,
      `--project=${projectInfo.projectId}`,
    ]);
    if (!metaListing) {
      throw new Error(`Export GCS concluído sem .overall_export_metadata verificável em '${gcsExportUri}'.`);
    }
    restorableBackup = {
      type: 'gcs_managed_export',
      restorable: true,
      gcsExportUri,
      overallMetadataObject: metaListing.split('\n')[0].trim(),
      metadataVerifiedAt: new Date().toISOString(),
      sanitizedAuditOnlyFiles: ['firestore-default-export.json', 'auth-users-sanitized.json'],
    };
    console.log(`      ✓ Backup integral restaurável confirmado no GCS: ${gcsExportUri}`);
  } else {
    console.log('[4/6] [AUDITORIA] --allow-audit-only-without-gcs ativo: nenhum backup integral GCS gerado.');
  }

  console.log(`[5/6] Exportando inventário sanitizado do Firestore '${TARGET_DATABASE_ID}' para planejamento...`);
  const fsExport = await exportAllFirestoreDocuments(projectInfo.projectId, tokenProvider);
  console.log(
    `      ✓ ${fsExport.exportedDocs.length} documento(s) inspecionados em ${fsExport.rootCollections.length} coleção(ões) raiz.`
  );

  const fullTestReset = !opts.selectiveLegacy;
  console.log(
    `[6/6] Classificando inventário (modo: ${fullTestReset ? 'ARCH.2G.2 Reset Completo' : 'ARCH.2G.1 Seletivo'})...`
  );
  const classified = classifyFirestoreInventory({
    exportedDocs: fsExport.exportedDocs,
    authUsers,
    cleanTestUids: opts.cleanTestUids,
    cleanTestEmails: opts.cleanTestEmails,
    fullTestReset,
  });

  const exportPayload = {
    schemaVersion: 'arch.2g.2',
    backupRole: 'AUDIT_ONLY_SANITIZED_CREDENTIALS_REDACTED',
    isIntegralRestorableBackup: false,
    warning:
      'Este JSON tem tokens e segredos substituidos por [REDACTED] apenas para auditoria offline. Para restauracao integral utilize o export gerenciado no GCS (backup-manifest.json -> restorableBackup.gcsExportUri).',
    exportedAt: new Date().toISOString(),
    projectId: projectInfo.projectId,
    projectNumber: projectInfo.projectNumber,
    databaseId: TARGET_DATABASE_ID,
    rootCollections: fsExport.rootCollections,
    collectionCounts: fsExport.collectionCounts,
    documentsCount: fsExport.exportedDocs.length,
    redactedSensitiveFields: fsExport.redactedFieldsTotal,
    documents: fsExport.exportedDocs,
  };

  const exportPath = path.join(outDir, 'firestore-default-export.json');
  const authPath = path.join(outDir, 'auth-users-sanitized.json');
  const planPath = path.join(outDir, 'cleanup-plan.json');
  const reportPath = path.join(outDir, 'inventory-report.md');
  const manifestPath = path.join(outDir, 'backup-manifest.json');
  const shaPath = path.join(outDir, 'backup.sha256');

  const exportJson = JSON.stringify(exportPayload, null, 2);
  const authJson = JSON.stringify(
    {
      schemaVersion: 'arch.2g.2',
      backupRole: 'AUDIT_ONLY_SANITIZED_NO_CREDENTIALS',
      listedAt: new Date().toISOString(),
      projectId: projectInfo.projectId,
      credentialsRedacted: true,
      count: authUsers.length,
      users: authUsers,
    },
    null,
    2
  );

  // Calcular hash determinístico do plano antes de gravar
  const canonicalPlanCore = {
    schemaVersion: 'arch.2g.2',
    resetScope: classified.summary.resetScope,
    projectId: projectInfo.projectId,
    databaseId: TARGET_DATABASE_ID,
    summary: classified.summary,
    authSummary: classified.authSummary,
    actions: classified.actions,
  };
  const planHash = sha256Hex(JSON.stringify(canonicalPlanCore));
  const fullPlan = { ...canonicalPlanCore, planHash, generatedAt: new Date().toISOString() };
  const planJson = JSON.stringify(fullPlan, null, 2);

  fs.writeFileSync(exportPath, exportJson, { mode: 0o600 });
  fs.writeFileSync(authPath, authJson, { mode: 0o600 });
  fs.writeFileSync(planPath, planJson, { mode: 0o600 });
  fs.writeFileSync(
    reportPath,
    buildInventoryMarkdown(projectInfo, activeWriters, authUsers, fullPlan, restorableBackup),
    { mode: 0o600 }
  );

  const exportSha256 = sha256File(exportPath);
  const authSha256 = sha256File(authPath);
  const planSha256 = sha256File(planPath);

  const manifest = {
    schemaVersion: 'arch.2g.2',
    resetScope: classified.summary.resetScope,
    status: 'COMPLETED',
    createdAt: new Date().toISOString(),
    projectId: projectInfo.projectId,
    projectNumber: projectInfo.projectNumber,
    databaseId: TARGET_DATABASE_ID,
    operatorAccount: projectInfo.activeAccount,
    gcsExportUri,
    restorableBackup,
    activeWritersSnapshot: activeWriters,
    counts: {
      authUsers: authUsers.length,
      totalDocs: fsExport.exportedDocs.length,
      preserveDocs: classified.summary.preserveCount,
      sanitizeDocs: classified.summary.sanitizeFieldsCount,
      deleteDocs: classified.summary.deleteDocCount,
      reviewDocs: classified.summary.reviewCount,
    },
    checksums: {
      'firestore-default-export.json': exportSha256,
      'auth-users-sanitized.json': authSha256,
      'cleanup-plan.json': planSha256,
      planHash,
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });

  const shaContent = [
    `${exportSha256}  firestore-default-export.json`,
    `${authSha256}  auth-users-sanitized.json`,
    `${planSha256}  cleanup-plan.json`,
  ].join('\n') + '\n';
  fs.writeFileSync(shaPath, shaContent, { mode: 0o600 });

  console.log('\n--- RESUMO DO INVENTÁRIO E BACKUP ---');
  console.log(`Diretório do Inventário  : ${outDir}`);
  console.log(`Escopo do Reset          : ${classified.summary.resetScope}`);
  console.log(`Backup Integral (GCS)    : ${gcsExportUri || 'NÃO GERADO (somente auditoria)'}`);
  console.log(`Usuários Firebase Auth   : ${authUsers.length} (PRESERVADOS 100%)`);
  console.log(`Documentos Preservados   : ${classified.summary.preserveCount}`);
  console.log(`Documentos Sanitizados   : ${classified.summary.sanitizeFieldsCount}`);
  console.log(`Documentos a Excluir     : ${classified.summary.deleteDocCount}`);
  console.log(`Documentos em Revisão    : ${classified.summary.reviewCount}`);
  console.log(`Plan Hash (SHA-256)      : ${planHash}`);
  console.log(`\nRevise o relatório completo antes de qualquer execução:`);
  console.log(`  cat "${reportPath}"`);
  if (restorableBackup.restorable) {
    console.log(`\nPara habilitar --execute-clean somente após aprovação e revisão do relatório:`);
    console.log(`  ./scripts/cloudshell-firestore-clean.sh --execute-clean \\`);
    console.log(`    --backup-dir "${outDir}" \\`);
    console.log(`    --confirm-project "${projectInfo.projectId}" \\`);
    console.log(`    --confirm-plan-hash "${planHash.slice(0, 16)}" \\`);
    console.log(`    --quiesce-cloud-run`);
  } else {
    console.log(`\n[AVISO] --execute-clean permanece BLOQUEADO sem --gcs-bucket (backup integral restaurável).`);
  }
  console.log('================================================================================\n');
}

// ============================================================================
// Modo 2: --execute-clean (com travas, quiesce, confirmação e journal)
// ============================================================================

function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

async function acquireFirestoreMaintenanceLock(projectId, tokenProvider, executionId, isResume) {
  const rootParent = `projects/${projectId}/databases/${TARGET_DATABASE_ID}/documents`;
  const docUrl = `https://firestore.googleapis.com/v1/${rootParent}/${MAINTENANCE_LOCK_DOC_PATH}`;
  const now = Date.now();
  const expiresAt = now + MAINTENANCE_LOCK_TTL_MS;

  const lockFields = {
    status: { stringValue: 'in_progress' },
    executionId: { stringValue: executionId },
    lockedAtMs: { integerValue: String(now) },
    expiresAtMs: { integerValue: String(expiresAt) },
    purpose: { stringValue: 'arch_2g_1_firestore_cleanup' },
  };

  // Tentar criar atomicamente com precondition exists=false
  const createUrl = `https://firestore.googleapis.com/v1/${rootParent}/_maintenance_locks?documentId=arch_2g_cleanup`;
  const createRes = await googleApiFetch(createUrl, {
    method: 'POST',
    body: { fields: lockFields },
    tokenProvider,
    projectId,
  });

  if (createRes.ok) {
    return;
  }

  // Se já existe, inspecionar se é retomada legítima ou lock expirado
  const getRes = await googleApiFetch(docUrl, { method: 'GET', tokenProvider, projectId });
  if (!getRes.ok) {
    throw new Error(`Não foi possível adquirir ou inspecionar trava '${MAINTENANCE_LOCK_DOC_PATH}' (HTTP ${getRes.status}).`);
  }

  const existing = decodeFirestoreDocFields(getRes.data);
  const existingExp = Number(existing.expiresAtMs || 0);
  const canReclaim =
    (isResume && existing.executionId === executionId) ||
    (existingExp > 0 && now > existingExp);

  if (!canReclaim) {
    throw new Error(
      `Execução concorrente bloqueada: trava '${MAINTENANCE_LOCK_DOC_PATH}' ativa ` +
        `(executionId=${existing.executionId || 'desconhecido'}). Aguarde conclusão ou expiração.`
    );
  }

  const patchUrl = `${docUrl}?currentDocument.updateTime=${encodeURIComponent(getRes.data.updateTime)}`;
  const patchRes = await googleApiFetch(patchUrl, {
    method: 'PATCH',
    body: { fields: lockFields },
    tokenProvider,
    projectId,
  });
  if (!patchRes.ok) {
    throw new Error(`Falha ao renovar trava de manutenção (HTTP ${patchRes.status}).`);
  }
}

async function releaseFirestoreMaintenanceLock(projectId, tokenProvider) {
  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${TARGET_DATABASE_ID}/documents/${MAINTENANCE_LOCK_DOC_PATH}`;
  await googleApiFetch(docUrl, { method: 'DELETE', tokenProvider, projectId }).catch(() => null);
}

function quiesceCloudRunServices(projectId, activeServices, stateFilePath) {
  let existingSnapshots = null;
  if (fs.existsSync(stateFilePath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
      if (Array.isArray(prev?.snapshots) && prev.snapshots.length > 0) {
        existingSnapshots = prev.snapshots;
      }
    } catch {}
  }

  const snapshots = existingSnapshots || activeServices.map((svc) => ({
    name: svc.name,
    region: svc.region,
    hasDiagnosticVar: Boolean(svc.hasDiagnosticVar),
    previousDiagnosticOnly: svc.diagnosticOnlyValue ?? null,
  }));

  if (!existingSnapshots) {
    fs.writeFileSync(
      stateFilePath,
      JSON.stringify({ projectId, snapshots, quiescedAt: new Date().toISOString() }, null, 2),
      { mode: 0o600 }
    );
  }

  for (const svc of activeServices) {
    console.log(`  [QUIESCE] Isolando Cloud Run '${svc.name}' (${svc.region}) -> DIAGNOSTIC_ONLY=true...`);
    runGcloud([
      'run',
      'services',
      'update',
      svc.name,
      `--project=${projectId}`,
      `--region=${svc.region}`,
      '--update-env-vars=DIAGNOSTIC_ONLY=true',
      '--quiet',
    ]);
  }
  return snapshots;
}

function restoreCloudRunServices(projectId, snapshots, stateFilePath) {
  for (const snap of snapshots) {
    if (snap.hasDiagnosticVar && snap.previousDiagnosticOnly !== null) {
      console.log(
        `  [RESTORE] Restaurando Cloud Run '${snap.name}' (${snap.region}) -> DIAGNOSTIC_ONLY=${snap.previousDiagnosticOnly}...`
      );
      runGcloud(
        [
          'run',
          'services',
          'update',
          snap.name,
          `--project=${projectId}`,
          `--region=${snap.region}`,
          `--update-env-vars=DIAGNOSTIC_ONLY=${snap.previousDiagnosticOnly}`,
          '--quiet',
        ],
        { allowFail: true }
      );
    } else {
      console.log(`  [RESTORE] Restaurando Cloud Run '${snap.name}' (${snap.region}) (removendo DIAGNOSTIC_ONLY)...`);
      runGcloud(
        [
          'run',
          'services',
          'update',
          snap.name,
          `--project=${projectId}`,
          `--region=${snap.region}`,
          '--remove-env-vars=DIAGNOSTIC_ONLY',
          '--quiet',
        ],
        { allowFail: true }
      );
    }
  }
  if (stateFilePath && fs.existsSync(stateFilePath)) {
    try {
      fs.unlinkSync(stateFilePath);
    } catch {}
  }
}

export function validateExecuteCleanPreconditions({
  backupDir,
  confirmProject,
  confirmPlanHash,
  allowStaleBackup = false,
  requireRestorableBackup = false,
  nowMs = Date.now(),
}) {
  if (!backupDir || !confirmProject || !confirmPlanHash) {
    throw new Error(
      'Para --execute-clean são OBRIGATÓRIOS: --backup-dir <dir>, --confirm-project <id> e --confirm-plan-hash <hash>.'
    );
  }

  const resolvedBackupDir = path.resolve(backupDir);
  const manifestPath = path.join(resolvedBackupDir, 'backup-manifest.json');
  const exportPath = path.join(resolvedBackupDir, 'firestore-default-export.json');
  const authPath = path.join(resolvedBackupDir, 'auth-users-sanitized.json');
  const planPath = path.join(resolvedBackupDir, 'cleanup-plan.json');

  for (const required of [manifestPath, exportPath, authPath, planPath]) {
    if (!fs.existsSync(required)) {
      throw new Error(`Artefato obrigatório de backup ausente: ${required}`);
    }
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.status !== 'COMPLETED') {
    throw new Error(`Backup inválido: status='${manifest.status}' (esperado 'COMPLETED').`);
  }
  if (manifest.databaseId !== TARGET_DATABASE_ID) {
    throw new Error(`Backup inválido: databaseId='${manifest.databaseId}' (esperado '${TARGET_DATABASE_ID}').`);
  }

  const ageHours = (nowMs - new Date(manifest.createdAt).getTime()) / (1000 * 60 * 60);
  if (ageHours > DEFAULT_BACKUP_MAX_AGE_HOURS && !allowStaleBackup) {
    throw new Error(
      `Backup tem ${ageHours.toFixed(1)}h (limite ${DEFAULT_BACKUP_MAX_AGE_HOURS}h). ` +
        `Gere um backup novo com --backup-only ou use --allow-stale-backup.`
    );
  }

  if (
    sha256File(exportPath) !== manifest.checksums?.['firestore-default-export.json'] ||
    sha256File(authPath) !== manifest.checksums?.['auth-users-sanitized.json'] ||
    sha256File(planPath) !== manifest.checksums?.['cleanup-plan.json']
  ) {
    throw new Error('FALHA DE INTEGRIDADE: Checksum SHA-256 dos arquivos de backup não confere.');
  }

  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (manifest.projectId !== confirmProject || plan.projectId !== confirmProject) {
    throw new Error(
      `Confirmação de projeto divergente: --confirm-project='${confirmProject}', backup='${manifest.projectId}'.`
    );
  }

  if (FORBIDDEN_LEGACY_PROJECT_IDS.has(confirmProject)) {
    throw new Error(`BLOQUEIO DE SEGURANÇA: Projeto legado '${confirmProject}' é estritamente proibido.`);
  }

  const cleanHashConfirm = String(confirmPlanHash).toLowerCase().trim();
  if (
    cleanHashConfirm.length < 12 ||
    !String(plan.planHash || '').toLowerCase().startsWith(cleanHashConfirm)
  ) {
    throw new Error(
      `Confirmação do inventário falhou: --confirm-plan-hash '${confirmPlanHash}' não confere com '${plan.planHash}'.`
    );
  }

  if (requireRestorableBackup) {
    const rb = manifest.restorableBackup;
    const gcsUri = String(rb?.gcsExportUri || manifest.gcsExportUri || '').trim();
    if (!rb || rb.type !== 'gcs_managed_export' || rb.restorable !== true || !gcsUri.startsWith('gs://')) {
      throw new Error(
        'BLOQUEIO DE SEGURANÇA: Backup integral restaurável ausente. O arquivo firestore-default-export.json é sanitizado (credenciais redactadas) e NÃO substitui um export gerenciado no GCS. Reexecute --backup-only com --gcs-bucket gs://SEU-BUCKET.'
      );
    }
  }

  return { backupDir: resolvedBackupDir, manifest, plan };
}

async function runExecuteClean(opts) {
  console.log('\n================================================================================');
  console.log(' ARCH.2G.2 — MODO --execute-clean (RESET CONTROLADO DO FIRESTORE (default))');
  console.log('================================================================================\n');

  const { backupDir, manifest, plan } = validateExecuteCleanPreconditions({
    backupDir: opts.backupDir,
    confirmProject: opts.confirmProject,
    confirmPlanHash: opts.confirmPlanHash,
    allowStaleBackup: opts.allowStaleBackup,
    requireRestorableBackup: true,
  });

  const journalPath = path.join(backupDir, 'execution-journal.jsonl');

  // Verificar projeto real ativo no Cloud Shell
  const projectInfo = detectTargetProject({
    project: opts.confirmProject,
    allowNonDefaultProject: opts.allowNonDefaultProject,
  });

  // Verificar que o export integral restaurável continua presente no GCS antes de qualquer mutação
  const gcsUri = String(manifest.restorableBackup?.gcsExportUri || manifest.gcsExportUri || '').trim();
  const verifiedGcsMeta = runGcloud([
    'storage',
    'ls',
    `${gcsUri}/*.overall_export_metadata`,
    `--project=${projectInfo.projectId}`,
  ]);
  if (!verifiedGcsMeta) {
    throw new Error(
      `BLOQUEIO DE SEGURANÇA: Export integral GCS '${gcsUri}' não encontrado ou sem '.overall_export_metadata'. Limpeza abortada.`
    );
  }
  console.log(`[BACKUP] Export integral restaurável verificado no GCS: ${gcsUri}`);

  // Verificar processos ativos que podem regravar dados antigos
  const activeWriters = inspectActiveWriters(projectInfo.projectId);
  let quiescedSnapshots = [];
  const quiesceStatePath = path.join(backupDir, 'cloudrun-quiesce-state.json');

  if (activeWriters.activeBusinessRun.length > 0 && !opts.quiesceCloudRun) {
    const names = activeWriters.activeBusinessRun.map((s) => `${s.name} (${s.region})`).join(', ');
    throw new Error(
      `BLOQUEIO DE SEGURANÇA: Serviço(s) Cloud Run ativo(s) detectado(s) [${names}] sem DIAGNOSTIC_ONLY=true. ` +
        `Processos ativos podem regravar caches antigos de RAM/app_state durante a limpeza. ` +
        `Reexecute com --quiesce-cloud-run para isolá-los em DIAGNOSTIC_ONLY=true durante a janela.`
    );
  }

  if (
    (activeWriters.cloudFunctions.length > 0 || activeWriters.enabledSchedulers.length > 0) &&
    !opts.acknowledgeNoActiveWriters
  ) {
    throw new Error(
      `BLOQUEIO DE SEGURANÇA: Detectadas Cloud Functions (${activeWriters.cloudFunctions.length}) ou ` +
        `Cloud Scheduler jobs ativos (${activeWriters.enabledSchedulers.length}). ` +
        `Confirme que não gravam dados antigos passando --acknowledge-no-active-writers.`
    );
  }

  if (!opts.quiesceCloudRun && !opts.acknowledgeNoActiveWriters) {
    throw new Error(
      `CONFIRMAÇÃO ANTI-CACHE OBRIGATÓRIA: Confirme que servidores locais ('tsx server.ts' / preview AI Studio) estão parados e abas fechadas passando --acknowledge-no-active-writers (ou --quiesce-cloud-run).`
    );
  }

  // Carregar estado anterior de retomada se --resume
  const completedPaths = new Set();
  let executionId = `exec-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  if (opts.resume && fs.existsSync(journalPath)) {
    const lines = fs.readFileSync(journalPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.executionId) executionId = ev.executionId;
        if (ev.status === 'COMPLETED' && ev.path) {
          completedPaths.add(`${ev.action}:${ev.path}`);
        }
      } catch {}
    }
    console.log(`[RESUME] Retomando executionId=${executionId} (${completedPaths.size} operações já concluídas).`);
  }

  const actionable = (plan.actions || []).filter(
    (a) => a.action === 'DELETE_DOC' || a.action === 'SANITIZE_FIELDS'
  );
  const pendingActions = actionable.filter((a) => !completedPaths.has(`${a.action}:${a.path}`));

  console.log('--- CONFIRMAÇÃO FINAL DE EXECUÇÃO ---');
  console.log(`Projeto Confirmado       : ${projectInfo.projectId} (#${projectInfo.projectNumber})`);
  console.log(`Banco de Dados           : ${TARGET_DATABASE_ID}`);
  console.log(`Backup Verificado        : ${backupDir}`);
  console.log(`Plan Hash (SHA-256)      : ${plan.planHash}`);
  console.log(`Firebase Auth Preservado : ${manifest.counts.authUsers} conta(s) (0 alterações)`);
  console.log(`Docs Preservados         : ${manifest.counts.preserveDocs}`);
  console.log(`Docs a Sanitizar         : ${manifest.counts.sanitizeDocs}`);
  console.log(`Docs a Excluir           : ${manifest.counts.deleteDocs}`);
  console.log(`Operações Pendentes      : ${pendingActions.length}\n`);

  const expectedPhrase = `CONFIRMAR LIMPEZA ${projectInfo.projectId}`;
  const typed = await promptLine(`Digite exatamente "${expectedPhrase}" para iniciar: `);
  if (typed.trim() !== expectedPhrase) {
    console.log('\n[ABORTADO] Confirmação não corresponde. Nenhuma alteração foi executada.\n');
    process.exit(1);
  }

  const tokenProvider = new GcloudTokenProvider();

  if (activeWriters.activeBusinessRun.length > 0 && opts.quiesceCloudRun) {
    quiescedSnapshots = quiesceCloudRunServices(
      projectInfo.projectId,
      activeWriters.activeBusinessRun,
      quiesceStatePath
    );
  } else if (opts.resume && fs.existsSync(quiesceStatePath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(quiesceStatePath, 'utf8'));
      if (Array.isArray(prev?.snapshots)) quiescedSnapshots = prev.snapshots;
    } catch {}
  }

  let lockAcquired = false;
  let succeeded = 0;
  let skippedResume = actionable.length - pendingActions.length;
  let failedErr = null;

  const appendJournal = (entry) => {
    fs.appendFileSync(
      journalPath,
      JSON.stringify({ ts: new Date().toISOString(), executionId, ...entry }) + '\n',
      { mode: 0o600 }
    );
  };

  try {
    await acquireFirestoreMaintenanceLock(projectInfo.projectId, tokenProvider, executionId, opts.resume);
    lockAcquired = true;
    console.log(`[LOCK] Trava exclusiva '${MAINTENANCE_LOCK_DOC_PATH}' adquirida.`);

    for (const item of pendingActions) {
      appendJournal({ action: item.action, path: item.path, status: 'STARTED' });

      if (item.action === 'DELETE_DOC') {
        const url = item.updateTime
          ? `https://firestore.googleapis.com/v1/${item.name}?currentDocument.updateTime=${encodeURIComponent(item.updateTime)}`
          : `https://firestore.googleapis.com/v1/${item.name}`;

        const res = await googleApiFetch(url, {
          method: 'DELETE',
          tokenProvider,
          projectId: projectInfo.projectId,
        });

        if (!res.ok) {
          if (res.status === 404 && opts.resume) {
            appendJournal({ action: item.action, path: item.path, status: 'COMPLETED', note: 'already_deleted_on_resume' });
            succeeded++;
            continue;
          }
          if (res.status === 400 || res.status === 409) {
            throw new Error(
              `CONFLITO DE CONCORRÊNCIA em '${item.path}': documento foi modificado por processo externo após o backup. Execução abortada com segurança.`
            );
          }
          throw new Error(`Erro ao excluir '${item.path}' (HTTP ${res.status}): ${res.data?.error?.message || ''}`);
        }
        appendJournal({ action: item.action, path: item.path, status: 'COMPLETED' });
        succeeded++;
      } else if (item.action === 'SANITIZE_FIELDS') {
        const removeFields = Array.isArray(item.removeFields) ? item.removeFields : [];
        const updateFields = item.updateFields && typeof item.updateFields === 'object' ? item.updateFields : {};
        const maskPaths = Array.from(new Set([...removeFields, ...Object.keys(updateFields)]));

        if (maskPaths.length === 0) {
          appendJournal({ action: item.action, path: item.path, status: 'COMPLETED', note: 'noop' });
          succeeded++;
          continue;
        }

        const qs = new URLSearchParams();
        for (const fp of maskPaths) {
          const safeMaskPath = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fp) ? fp : `\`${fp.replace(/`/g, '')}\``;
          qs.append('updateMask.fieldPaths', safeMaskPath);
        }
        if (item.updateTime) {
          qs.set('currentDocument.updateTime', item.updateTime);
        }

        const encodedFields = {};
        for (const [k, v] of Object.entries(updateFields)) {
          encodedFields[k] = encodeFirestoreValue(v);
        }

        const url = `https://firestore.googleapis.com/v1/${item.name}?${qs.toString()}`;
        const res = await googleApiFetch(url, {
          method: 'PATCH',
          body: { fields: encodedFields },
          tokenProvider,
          projectId: projectInfo.projectId,
        });

        if (!res.ok) {
          if (res.status === 400 || res.status === 409) {
            throw new Error(
              `CONFLITO DE CONCORRÊNCIA em '${item.path}': documento foi alterado por processo externo após o backup. Execução abortada.`
            );
          }
          throw new Error(`Erro ao sanitizar '${item.path}' (HTTP ${res.status}): ${res.data?.error?.message || ''}`);
        }
        appendJournal({ action: item.action, path: item.path, status: 'COMPLETED' });
        succeeded++;
      }
    }
  } catch (err) {
    failedErr = err;
    appendJournal({ status: 'FAILED', error: err.message });
  } finally {
    if (lockAcquired && !failedErr) {
      await releaseFirestoreMaintenanceLock(projectInfo.projectId, tokenProvider);
      console.log(`[LOCK] Trava '${MAINTENANCE_LOCK_DOC_PATH}' liberada.`);
    }
    if (quiescedSnapshots.length > 0) {
      restoreCloudRunServices(projectInfo.projectId, quiescedSnapshots, quiesceStatePath);
    }
  }

  if (failedErr) {
    console.error(`\n[FALHA RECUPERÁVEL] ${failedErr.message}`);
    console.error(`Progresso salvo em: ${journalPath}`);
    console.error(`Para retomar de onde parou após resolver a causa:`);
    const quiesceFlag = opts.quiesceCloudRun ? ' --quiesce-cloud-run' : '';
    console.error(
      `  ./scripts/cloudshell-firestore-clean.sh --execute-clean --resume${quiesceFlag} --backup-dir "${backupDir}" --confirm-project "${opts.confirmProject}" --confirm-plan-hash "${opts.confirmPlanHash}"\n`
    );
    process.exit(1);
  }

  const summaryOut = {
    completedAt: new Date().toISOString(),
    executionId,
    projectId: projectInfo.projectId,
    databaseId: TARGET_DATABASE_ID,
    succeededNow: succeeded,
    skippedAlreadyCompleted: skippedResume,
    authPreserved: manifest.counts.authUsers,
  };
  fs.writeFileSync(path.join(backupDir, 'clean-result-summary.json'), JSON.stringify(summaryOut, null, 2), {
    mode: 0o600,
  });

  console.log('\n[CONCLUÍDO] Limpeza executada com sucesso.');
  console.log(`  Operações executadas agora : ${succeeded}`);
  console.log(`  Operações retomadas/puladas: ${skippedResume}`);
  console.log(`  Contas Firebase Auth       : ${manifest.counts.authUsers} (100% preservadas)\n`);
}

// ============================================================================
// Entrypoint CLI
// ============================================================================

const isDirectCli = process.argv[1] && process.argv[1].includes('arch2g1-firestore-clean');

if (isDirectCli) {
  (async () => {
    try {
      const opts = parseCliArgs(process.argv.slice(2));
      try {
        execFileSync('gcloud', ['--version'], { stdio: 'ignore' });
      } catch {
        throw new Error('Google Cloud CLI (gcloud) não encontrado. Execute este script no Google Cloud Shell.');
      }
      if (opts.backupOnly) {
        await runBackupOnly(opts);
      } else if (opts.executeClean) {
        await runExecuteClean(opts);
      }
    } catch (err) {
      console.error(`\n[ERRO] ${err?.message || err}\n`);
      process.exit(1);
    }
  })();
}
__ARCH2G1_NODE_EOF__

node "${TMP_JS}" "$@"
