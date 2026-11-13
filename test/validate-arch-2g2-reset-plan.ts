import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT_DIR = process.cwd();
const SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'cloudshell-firestore-clean.sh');
const DOC_PATH = path.join(ROOT_DIR, 'docs', 'arch-2g2-plano-reset-limpeza-firestore.md');
const RULES_PATH = path.join(ROOT_DIR, 'firestore.rules');

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function extractEmbeddedNodeModule(scriptText: string): string {
  const startMarker = "cat <<'__ARCH2G1_NODE_EOF__' > \"${TMP_JS}\"\n";
  const endMarker = '\n__ARCH2G1_NODE_EOF__';
  const startIdx = scriptText.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'Marcador inicial do módulo Node embutido não encontrado');
  const contentStart = startIdx + startMarker.length;
  const endIdx = scriptText.indexOf(endMarker, contentStart);
  assert.notEqual(endIdx, -1, 'Marcador final do módulo Node embutido não encontrado');
  return scriptText.slice(contentStart, endIdx);
}

async function main() {
  console.log('=== VALIDATION ARCH.2G.2 — Full Test Data Reset & Restorable GCS Backup ===');

  assert.ok(fs.existsSync(SCRIPT_PATH), 'scripts/cloudshell-firestore-clean.sh deve existir');
  assert.ok(fs.existsSync(DOC_PATH), 'docs/arch-2g2-plano-reset-limpeza-firestore.md deve existir');
  assert.ok(fs.existsSync(RULES_PATH), 'firestore.rules deve permanecer intacto');

  const stat = fs.statSync(SCRIPT_PATH);
  assert.ok((stat.mode & 0o111) !== 0, 'scripts/cloudshell-firestore-clean.sh deve ser executável (+x)');

  const scriptText = fs.readFileSync(SCRIPT_PATH, 'utf8');
  assert.ok(!scriptText.includes('firebase-admin'), 'Script não deve depender de firebase-admin');
  assert.ok(!scriptText.includes('accounts:delete'), 'Script nunca deve excluir Firebase Auth');
  assert.ok(!scriptText.includes('accounts:update'), 'Script nunca deve alterar Firebase Auth');
  assert.ok(!scriptText.includes('firebase deploy'), 'Script nunca deve fazer deploy');
  assert.ok(!scriptText.includes('firestore:rules'), 'Script nunca deve alterar firestore.rules');
  assert.ok(scriptText.includes('gcloud firestore export'), 'Script deve suportar backup nativo GCS');
  assert.ok(scriptText.includes('overall_export_metadata'), 'Script deve verificar metadata do export GCS');

  execFileSync('bash', ['-n', SCRIPT_PATH], { stdio: 'pipe' });
  const helpOut = execFileSync(SCRIPT_PATH, ['--help'], { encoding: 'utf8', stdio: 'pipe' });
  assert.ok(helpOut.includes('--gcs-bucket'), '--help deve documentar --gcs-bucket obrigatório');
  assert.ok(helpOut.includes('--allow-audit-only-without-gcs'), '--help deve documentar modo audit-only');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch2g2-test-'));
  const tmpModulePath = path.join(tmpDir, 'clean-lib.mjs');

  try {
    fs.writeFileSync(tmpModulePath, extractEmbeddedNodeModule(scriptText), 'utf8');
    const mod = await import(pathToFileURL(tmpModulePath).href);

    // 1. CLI parsing para flags ARCH.2G.2
    const parsedAudit = mod.parseCliArgs([
      '--backup-only',
      '--allow-audit-only-without-gcs',
      '--selective-legacy',
    ]);
    assert.equal(parsedAudit.backupOnly, true);
    assert.equal(parsedAudit.allowAuditOnlyWithoutGcs, true);
    assert.equal(parsedAudit.selectiveLegacy, true);

    // 2. Cenário completo ARCH.2G.2 com os 4 usuários reais no Firebase Auth
    const adminUid = 'AdminRealUid12345678901234';
    const studentRealUid = 'StudentRealUid123456789012';
    const tutorRealUid = 'TutorRealUid12345678901234';
    const secondStudentRealUid = 'StudentReal2Uid12345678901';

    const authUsers = [
      {
        uid: adminUid,
        email: 'adm.itissimple@gmail.com',
        customClaims: { role: 'admin', admin: true },
      },
      {
        uid: studentRealUid,
        email: 'aluno.real1@gmail.com',
        customClaims: { role: 'student' },
      },
      {
        uid: tutorRealUid,
        email: 'native.friend.real@gmail.com',
        customClaims: { role: 'teacher' },
      },
      {
        uid: secondStudentRealUid,
        email: 'aluno.real2@gmail.com',
        customClaims: {},
      },
    ];

    const mkDoc = (relPath: string, data: Record<string, unknown>, docId?: string) => {
      const segs = relPath.split('/');
      return {
        name: `projects/itissimple-security-staging/databases/(default)/documents/${relPath}`,
        path: relPath,
        rootCollection: segs[0],
        collectionPath: segs.slice(0, -1).join('/'),
        docId: docId || segs[segs.length - 1],
        depth: Math.floor(segs.length / 2),
        updateTime: '2026-11-13T10:00:00Z',
        data,
      };
    };

    const exportedDocs = [
      // Estruturais preservados
      mkDoc('app_state/admin_bootstrap', { locked: true, adminEmail: 'adm.itissimple@gmail.com' }),
      mkDoc('app_state/youtube_playlists', { playlists: [{ id: 'pl-1' }] }),
      mkDoc('app_state/youtube_auth', { connected: true, token: '[REDACTED]' }),
      mkDoc('ptax_rates/2026-11-13', { usdBrl: 5.75 }),

      // app_state com resíduos de teste (inclusive meetSettings, teacherSettings, contractedLessons, etc.)
      mkDoc('app_state/main_data', {
        landingContent: { heroTitle: 'It Is Simple' },
        spotifyPlaylists: { beginner: {} },
        updatedAt: '2026-11-13T10:00:00Z',
        meetSettings: { 'native.friend.real@gmail.com': { url: 'https://meet.google.com/test' } },
        teacherSettings: { [tutorRealUid]: { timezone: 'UTC' } },
        chatMessages: [{ id: 'msg-1' }],
        dictionary: { hello: { pt: 'ola' } },
        studentActivityJournal: { 'aluno.real1@gmail.com': [] },
        studentSpotifyCycles: { 'aluno.real1@gmail.com': { week: 1 } },
        cycleAttempts: { att1: { attemptId: 'att1' } },
        students: [{ uid: studentRealUid, email: 'aluno.real1@gmail.com' }],
        userProfiles: { 'aluno.real1@gmail.com': { uid: studentRealUid } },
        authUsers: { 'aluno.real1@gmail.com': { uid: studentRealUid } },
        isAdministratorBootstrapped: true,
      }),
      mkDoc('app_state/routines', {
        routinesByDay: { monday: [] },
        updatedAt: '2026-11-13T10:00:00Z',
        studentRoutinesMap: { 'aluno.real1@gmail.com': {} },
        studentCurrentRoutines: { [studentRealUid]: {} },
      }),
      mkDoc('app_state/tutors', {
        teachers: [
          { uid: adminUid, email: 'adm.itissimple@gmail.com', role: 'admin' },
          { uid: tutorRealUid, email: 'native.friend.real@gmail.com', role: 'teacher' },
        ],
        tutorsList: [{ uid: tutorRealUid, email: 'native.friend.real@gmail.com' }],
        deletedTutorEmails: ['old@test.com'],
        deletedTutorIds: ['tutor-1'],
      }),
      mkDoc('app_state/lessons', {
        contractedLessons: {
          'aluno.real1@gmail.com': { remaining: 8 },
          'aluno.real2@gmail.com': { remaining: 2 },
        },
        liveLessons: [{ id: 'old-live' }],
      }),
      mkDoc('app_state/assignments', { studentVideoAssignments: { [studentRealUid]: [] } }),
      mkDoc('app_state/main', { legacy: true }),
      mkDoc('app_state/test-probe-9', { ok: true }),

      // Admin root poluído com campos de teste + subcoleção de teste do admin
      mkDoc(`users/${adminUid}`, {
        uid: adminUid,
        id: adminUid,
        email: 'adm.itissimple@gmail.com',
        name: 'Admin',
        role: 'student', // poluição intencional de teste que precisa voltar para 'admin'
        level: 'intermediate',
        studentRoutines: { monday: [] },
        password: 'legacy',
      }),
      mkDoc(`users/${adminUid}/vocabulary/hello`, { word: 'hello' }),
      mkDoc(`users/${adminUid}/lessons/les-adm-1`, { lessonId: 'les-adm-1' }),

      // Perfis e todas as subcoleções dos usuários reais (dados de teste a resetar!)
      mkDoc(`users/${studentRealUid}`, { email: 'aluno.real1@gmail.com', role: 'student' }),
      mkDoc(`users/${studentRealUid}/routines/monday`, { activities: [] }),
      mkDoc(`users/${studentRealUid}/currentRoutine/weekData`, { cycle: 1 }),
      mkDoc(`users/${studentRealUid}/weeklyChecks/week-1`, { checks: {} }),
      mkDoc(`users/${studentRealUid}/homework/week-1`, { text: 'hw' }),
      mkDoc(`users/${studentRealUid}/weeklyHistory/week-1`, { summary: 'ok' }),
      mkDoc(`users/${studentRealUid}/vocabulary/resilience`, { word: 'resilience' }),
      mkDoc(`users/${studentRealUid}/journal/j-1`, { text: 'My day' }),
      mkDoc(`users/${studentRealUid}/activity_journal/aj-1`, { text: 'Activity' }),
      mkDoc(`users/${studentRealUid}/studentJournal/sj-1`, { text: 'Legacy journal' }),
      mkDoc(`users/${studentRealUid}/session_notes/review_cycle`, { cycle: 1 }),
      mkDoc(`users/${studentRealUid}/lessons/les-real-1`, { id: 'les-real-1' }),
      mkDoc(`users/${studentRealUid}/memorization/mem-1`, { score: 100 }),
      mkDoc(`users/${secondStudentRealUid}`, { email: 'aluno.real2@gmail.com', role: 'student' }),

      // Tutores, vínculos, disponibilidade, agendamentos, notas, mensagens, insights e financeiro dos usuários reais
      mkDoc(`users/${tutorRealUid}`, { email: 'native.friend.real@gmail.com', role: 'teacher' }),
      mkDoc(`users/${tutorRealUid}/lessons/les-real-1`, { id: 'les-real-1' }),
      mkDoc(`tutors/${tutorRealUid}`, { uid: tutorRealUid, email: 'native.friend.real@gmail.com', bio: 'Bio' }),
      mkDoc(`tutors/${tutorRealUid}/lessons/les-real-1`, { id: 'les-real-1' }),
      mkDoc(`student_assignments/${studentRealUid}`, { studentUid: studentRealUid, teacherUid: tutorRealUid }),
      mkDoc(`teacher_availability/${tutorRealUid}`, { teacherUid: tutorRealUid, slots: ['Mon 10:00'] }),
      mkDoc('lessons/les-real-1', { studentUid: studentRealUid, teacherUid: tutorRealUid }),
      mkDoc('session_notes/note-real-1', { studentUid: studentRealUid, teacherUid: tutorRealUid, rawNotes: 'Notes' }),
      mkDoc('session_notes/note-real-1/pedagogical_cache/part1', { html: '<p>Cache</p>' }),
      mkDoc('direct_messages/dm-real-1', { senderUid: tutorRealUid, recipientUid: studentRealUid, text: 'Hi' }),
      mkDoc('lesson_insights/ins-real-1', { studentUid: studentRealUid, lessonId: 'les-real-1' }),
      mkDoc('financial_transactions/tx-real-1', { studentUid: studentRealUid, teacherUid: tutorRealUid, amountBrl: 120 }),

      // Coleções descontinuadas e desconhecida
      mkDoc('live_lessons/ll-1', { id: 'll-1' }),
      mkDoc('student_homework/sh-1', { id: 'sh-1' }),
      mkDoc('_diagnostic_probes/p-1', { ok: true }),
      mkDoc('gemini_inflight_locks/g-1', { ts: 1 }),
      mkDoc('gemini_rate_limits/r-1', { count: 2 }),
      mkDoc('future_unknown_collection/item-1', { custom: true }),
    ];

    const plan = mod.classifyFirestoreInventory({
      exportedDocs,
      authUsers,
      fullTestReset: true,
    });

    assert.equal(plan.summary.resetScope, 'arch.2g.2-full-test-reset');
    assert.equal(plan.authSummary.totalAuthUsers, 4);
    assert.equal(plan.authSummary.adminCount, 1);

    const byPath = new Map<string, any>(plan.actions.map((a: any) => [a.path, a]));

    // Preservados essenciais
    for (const p of [
      'app_state/admin_bootstrap',
      'app_state/youtube_playlists',
      'app_state/youtube_auth',
      'ptax_rates/2026-11-13',
    ]) {
      assert.equal(byPath.get(p)?.action, 'PRESERVE', `Esperado PRESERVE em ${p}`);
    }
    assert.equal(byPath.get('future_unknown_collection/item-1')?.action, 'REVIEW');

    // Sanitizações de app_state e users/{adminUid}
    const mainDataAct = byPath.get('app_state/main_data');
    assert.equal(mainDataAct.action, 'SANITIZE_FIELDS');
    assert.deepEqual(mainDataAct.preserveFields.sort(), ['landingContent', 'spotifyPlaylists', 'updatedAt']);
    for (const removed of ['meetSettings', 'teacherSettings', 'chatMessages', 'dictionary', 'studentActivityJournal', 'studentSpotifyCycles', 'cycleAttempts', 'students', 'userProfiles', 'authUsers', 'isAdministratorBootstrapped']) {
      assert.ok(mainDataAct.removeFields.includes(removed), `Esperado remover ${removed} de main_data`);
    }

    const routinesAct = byPath.get('app_state/routines');
    assert.equal(routinesAct.action, 'SANITIZE_FIELDS');
    assert.ok(routinesAct.removeFields.includes('studentRoutinesMap'));
    assert.ok(routinesAct.removeFields.includes('studentCurrentRoutines'));

    const tutorsAct = byPath.get('app_state/tutors');
    assert.equal(tutorsAct.action, 'SANITIZE_FIELDS');
    assert.equal(tutorsAct.updateFields.teachers.length, 1);
    assert.equal(tutorsAct.updateFields.teachers[0].uid, adminUid);
    assert.ok(tutorsAct.removeFields.includes('tutorsList'));

    const lessonsAct = byPath.get('app_state/lessons');
    assert.equal(lessonsAct.action, 'SANITIZE_FIELDS');
    assert.deepEqual(lessonsAct.updateFields.contractedLessons, {});
    assert.ok(lessonsAct.removeFields.includes('liveLessons'));

    const adminRootAct = byPath.get(`users/${adminUid}`);
    assert.equal(adminRootAct.action, 'SANITIZE_FIELDS');
    assert.equal(adminRootAct.updateFields.role, 'admin');
    assert.ok(adminRootAct.removeFields.includes('level'));
    assert.ok(adminRootAct.removeFields.includes('studentRoutines'));
    assert.ok(adminRootAct.removeFields.includes('password'));

    // Todos os dados de teste dos 4 usuários reais -> DELETE_DOC
    const expectedDeletes = [
      'app_state/assignments',
      'app_state/main',
      'app_state/test-probe-9',
      `users/${adminUid}/vocabulary/hello`,
      `users/${adminUid}/lessons/les-adm-1`,
      `users/${studentRealUid}`,
      `users/${studentRealUid}/routines/monday`,
      `users/${studentRealUid}/currentRoutine/weekData`,
      `users/${studentRealUid}/weeklyChecks/week-1`,
      `users/${studentRealUid}/homework/week-1`,
      `users/${studentRealUid}/weeklyHistory/week-1`,
      `users/${studentRealUid}/vocabulary/resilience`,
      `users/${studentRealUid}/journal/j-1`,
      `users/${studentRealUid}/activity_journal/aj-1`,
      `users/${studentRealUid}/studentJournal/sj-1`,
      `users/${studentRealUid}/session_notes/review_cycle`,
      `users/${studentRealUid}/lessons/les-real-1`,
      `users/${studentRealUid}/memorization/mem-1`,
      `users/${secondStudentRealUid}`,
      `users/${tutorRealUid}`,
      `users/${tutorRealUid}/lessons/les-real-1`,
      `tutors/${tutorRealUid}`,
      `tutors/${tutorRealUid}/lessons/les-real-1`,
      `student_assignments/${studentRealUid}`,
      `teacher_availability/${tutorRealUid}`,
      'lessons/les-real-1',
      'session_notes/note-real-1',
      'session_notes/note-real-1/pedagogical_cache/part1',
      'direct_messages/dm-real-1',
      'lesson_insights/ins-real-1',
      'financial_transactions/tx-real-1',
      'live_lessons/ll-1',
      'student_homework/sh-1',
      '_diagnostic_probes/p-1',
      'gemini_inflight_locks/g-1',
      'gemini_rate_limits/r-1',
    ];
    for (const delPath of expectedDeletes) {
      assert.equal(byPath.get(delPath)?.action, 'DELETE_DOC', `Esperado DELETE_DOC para ${delPath}`);
    }

    // Ordem: pedagogical_cache antes do doc pai session_notes
    const idxCache = plan.actions.findIndex((a: any) => a.path === 'session_notes/note-real-1/pedagogical_cache/part1');
    const idxNote = plan.actions.findIndex((a: any) => a.path === 'session_notes/note-real-1');
    assert.ok(idxCache !== -1 && idxNote !== -1 && idxCache < idxNote, 'Subcoleção pedagogical_cache deve ser excluída antes do pai');

    // 3. Bloqueio rigoroso contra considerar JSON sanitizado como backup integral
    const backupDir = path.join(tmpDir, 'arch2g2-backup');
    fs.mkdirSync(backupDir, { recursive: true });
    const exportFile = path.join(backupDir, 'firestore-default-export.json');
    const authFile = path.join(backupDir, 'auth-users-sanitized.json');
    const planFile = path.join(backupDir, 'cleanup-plan.json');
    const manifestFile = path.join(backupDir, 'backup-manifest.json');

    const planHash = sha256Text(JSON.stringify({ summary: plan.summary, actions: plan.actions }));
    fs.writeFileSync(exportFile, JSON.stringify({ isIntegralRestorableBackup: false, documents: exportedDocs }), 'utf8');
    fs.writeFileSync(authFile, JSON.stringify({ users: authUsers }), 'utf8');
    fs.writeFileSync(
      planFile,
      JSON.stringify({ projectId: 'itissimple-security-staging', databaseId: '(default)', planHash }),
      'utf8'
    );

    const writeManifest = (overrides: Record<string, unknown> = {}) => {
      fs.writeFileSync(
        manifestFile,
        JSON.stringify({
          status: 'COMPLETED',
          createdAt: new Date().toISOString(),
          projectId: 'itissimple-security-staging',
          databaseId: '(default)',
          checksums: {
            'firestore-default-export.json': sha256File(exportFile),
            'auth-users-sanitized.json': sha256File(authFile),
            'cleanup-plan.json': sha256File(planFile),
            planHash,
          },
          ...overrides,
        }),
        'utf8'
      );
    };

    // Sem restorableBackup GCS -> DEVE rejeitar com requireRestorableBackup: true
    writeManifest({
      restorableBackup: {
        type: 'none_sanitized_audit_only',
        restorable: false,
        gcsExportUri: null,
      },
    });
    assert.throws(
      () =>
        mod.validateExecuteCleanPreconditions({
          backupDir,
          confirmProject: 'itissimple-security-staging',
          confirmPlanHash: planHash.slice(0, 16),
          requireRestorableBackup: true,
        }),
      /Backup integral restaurável ausente/i
    );

    // Com export gerenciado no GCS -> DEVE aprovar
    writeManifest({
      gcsExportUri: 'gs://itissimple-security-staging-backups/arch2g2-itissimple-security-staging-2026',
      restorableBackup: {
        type: 'gcs_managed_export',
        restorable: true,
        gcsExportUri: 'gs://itissimple-security-staging-backups/arch2g2-itissimple-security-staging-2026',
      },
    });
    const ok = mod.validateExecuteCleanPreconditions({
      backupDir,
      confirmProject: 'itissimple-security-staging',
      confirmPlanHash: planHash.slice(0, 16),
      requireRestorableBackup: true,
    });
    assert.equal(ok.manifest.restorableBackup.restorable, true);

    console.log('✓ Todos os testes ARCH.2G.2 passaram (reset completo dos 4 usuários, app_state zerado, backup integral GCS obrigatório).');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
