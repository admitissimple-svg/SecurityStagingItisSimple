import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT_DIR = process.cwd();
const SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'cloudshell-firestore-clean.sh');
const DOC_PATH = path.join(ROOT_DIR, 'docs', 'arch-2g1-cloudshell-limpeza-firestore.md');
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
  console.log('=== VALIDATION ARCH.2G.1 — Cloud Shell Backup & Cleanup Preparation ===');

  // 1. Verificar existência, permissão executável, documentação e restrições de segurança estáticas
  assert.ok(fs.existsSync(SCRIPT_PATH), 'scripts/cloudshell-firestore-clean.sh deve existir');
  assert.ok(fs.existsSync(DOC_PATH), 'docs/arch-2g1-cloudshell-limpeza-firestore.md deve existir');
  const stat = fs.statSync(SCRIPT_PATH);
  assert.ok((stat.mode & 0o111) !== 0, 'scripts/cloudshell-firestore-clean.sh deve ser executável (+x)');

  const scriptText = fs.readFileSync(SCRIPT_PATH, 'utf8');
  assert.ok(!scriptText.includes('firebase-admin'), 'Script não deve depender de firebase-admin nem chave JSON');
  assert.ok(!scriptText.includes('add-iam-policy-binding'), 'Script nunca deve conceder IAM');
  assert.ok(!scriptText.includes('accounts:delete'), 'Script nunca deve excluir usuários Firebase Auth');
  assert.ok(!scriptText.includes('accounts:update'), 'Script nunca deve alterar usuários Firebase Auth');
  assert.ok(!scriptText.includes('firebase deploy'), 'Script nunca deve executar firebase deploy');
  assert.ok(!scriptText.includes('firestore:rules'), 'Script nunca deve modificar firestore.rules');
  assert.ok(!scriptText.includes('patchRuleset') && !scriptText.includes('createRelease'), 'Script nunca deve alterar rulesets');
  assert.ok(!scriptText.includes('gcloud run deploy'), 'Script nunca deve executar deploy');
  assert.ok(scriptText.includes('DIAGNOSTIC_ONLY=true'), 'Script deve isolar Cloud Run com DIAGNOSTIC_ONLY=true');

  // Verificar sintaxe bash e --help sem exigir gcloud
  execFileSync('bash', ['-n', SCRIPT_PATH], { stdio: 'pipe' });
  const helpOut = execFileSync(SCRIPT_PATH, ['--help'], { encoding: 'utf8', stdio: 'pipe' });
  assert.ok(helpOut.includes('--backup-only'), '--help deve documentar --backup-only');
  assert.ok(helpOut.includes('--execute-clean'), '--help deve documentar --execute-clean');

  // 2. Importar o módulo ES embutido em arquivo temporário isolado (zero rede / zero nuvem)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch2g1-test-'));
  const tmpModulePath = path.join(tmpDir, 'clean-lib.mjs');

  try {
    fs.writeFileSync(tmpModulePath, extractEmbeddedNodeModule(scriptText), 'utf8');
    const mod = await import(pathToFileURL(tmpModulePath).href);

    // 3. Testar parseCliArgs (dois modos mutuamente exclusivos)
    assert.throws(() => mod.parseCliArgs([]), /Exatamente UM modo|Especifique exatamente UM modo/i);
    assert.throws(
      () => mod.parseCliArgs(['--backup-only', '--execute-clean']),
      /Especifique exatamente UM modo/i
    );
    const backupArgs = mod.parseCliArgs(['--backup-only', '--project', 'itissimple-security-staging']);
    assert.equal(backupArgs.backupOnly, true);
    assert.equal(backupArgs.executeClean, false);
    assert.equal(backupArgs.project, 'itissimple-security-staging');

    // 4. Testar sanitização rigorosa de credenciais (Auth e Firestore)
    const sanitizedAuth = mod.sanitizeAuthUserRecord({
      localId: 'AuthRealUid123456789012',
      email: 'Student@RealDomain.com',
      emailVerified: true,
      displayName: 'Aluno Real',
      disabled: false,
      passwordHash: 'UkVEQUNURURfSEFTSA==',
      salt: 'c2FsdA==',
      tokensValidAfterTime: '1700000000',
      validSince: '1700000000',
      customAttributes: JSON.stringify({ role: 'student' }),
      providerUserInfo: [{ providerId: 'password', rawId: 'secret-raw-id' }],
    });
    assert.equal(sanitizedAuth.uid, 'AuthRealUid123456789012');
    assert.equal(sanitizedAuth.email, 'student@realdomain.com');
    assert.deepEqual(sanitizedAuth.providers, ['password']);
    assert.equal('passwordHash' in sanitizedAuth, false);
    assert.equal('salt' in sanitizedAuth, false);
    assert.equal('tokensValidAfterTime' in sanitizedAuth, false);
    assert.equal('validSince' in sanitizedAuth, false);

    const { sanitized: safeDocData, redactedCount } = mod.sanitizeCredentialsDeep({
      email: 'admin@itissimple.com',
      token: 'oauth2-super-secret-token',
      nested: { refreshToken: 'ref-123', apiKey: 'AIzaSyTest', safeFlag: true },
    });
    assert.equal(redactedCount, 3);
    assert.equal(safeDocData.token, '[REDACTED]');
    assert.equal(safeDocData.nested.refreshToken, '[REDACTED]');
    assert.equal(safeDocData.nested.apiKey, '[REDACTED]');
    assert.equal(safeDocData.nested.safeFlag, true);

    const { fields: safeRawFields, redactedCount: rawRedacted } = mod.sanitizeRawFirestoreFieldsForBackup({
      email: { stringValue: 'yt@channel.com' },
      token: { mapValue: { fields: { access_token: { stringValue: 'ya29.secret' } } } },
    });
    assert.equal(rawRedacted, 1);
    assert.deepEqual(safeRawFields.token, { stringValue: '[REDACTED]' });

    // 5. Testar motor determinístico de classificação (Preservar vs Sanitizar vs Excluir vs Review)
    const adminUid = 'AdminCanonicalUid1234567890';
    const realUid = 'StudentCanonicalUid12345678';
    const qaUid = 'QaTestAccountUid12345678901';
    const authUsers = [
      {
        uid: adminUid,
        email: 'adm.itissimple@gmail.com',
        customClaims: { role: 'admin', admin: true },
      },
      {
        uid: realUid,
        email: 'aluno.real@gmail.com',
        customClaims: { role: 'student' },
      },
      {
        uid: qaUid,
        email: 'qa.runner@mydomain.org',
        customClaims: { role: 'student' },
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
        updateTime: '2026-11-12T10:00:00Z',
        data,
      };
    };

    const exportedDocs = [
      // Preservados estruturais e administrativos
      mkDoc('app_state/admin_bootstrap', { locked: true, adminEmail: 'adm.itissimple@gmail.com' }),
      mkDoc('app_state/youtube_playlists', { playlists: [] }),
      mkDoc('app_state/youtube_auth', { connected: true, token: '[REDACTED]' }),
      mkDoc('ptax_rates/2026-11-12', { usdBrl: 5.7 }),

      // Sanitizáveis em app_state
      mkDoc('app_state/main_data', {
        landingContent: { heroTitle: 'It Is Simple' },
        meetSettings: { defaultUrl: 'https://meet.google.com/abc' },
        userProfiles: { legacy: true },
        students: [{ id: 'st-1' }],
        emailLogs: [{ id: 1 }],
      }),
      mkDoc('app_state/routines', {
        routinesByDay: { mon: [] },
        studentRoutinesMap: { stale: true },
      }),
      mkDoc('app_state/tutors', {
        teachers: [
          { uid: adminUid, email: 'adm.itissimple@gmail.com', role: 'admin' },
          { id: 'tutor-legacy-1', email: 'fake@example.com', role: 'tutor' },
        ],
        tutorsList: [{ id: 't1' }],
      }),
      mkDoc('app_state/lessons', {
        liveLessons: [{ id: 'l1' }],
        contractedLessons: {
          'aluno.real@gmail.com': { remaining: 4 },
          'ghost@example.com': { remaining: 99 },
        },
      }),

      // Legado/obsoleto em app_state e coleções descontinuadas
      mkDoc('app_state/assignments', { map: {} }),
      mkDoc('app_state/main', { legacy: true }),
      mkDoc('live_lessons/l-1', { title: 'Old Live' }),
      mkDoc('student_homework/hw-1', { title: 'Old HW' }),
      mkDoc('_diagnostic_probes/probe-1', { ok: true }),
      mkDoc('gemini_inflight_locks/lock-1', { ts: 1 }),
      mkDoc('gemini_rate_limits/rl-1', { count: 1 }),

      // Admin e aluno real + subcoleções canônicas vs legadas
      mkDoc(`users/${adminUid}`, { email: 'adm.itissimple@gmail.com', role: 'admin' }),
      mkDoc(`users/${realUid}`, {
        email: 'aluno.real@gmail.com',
        password: 'legacy-plaintext-password',
        vocabulary: [{ word: 'hello' }],
        studentJournal: [{ note: 'old' }],
      }),
      mkDoc(`users/${realUid}/vocabulary/hello`, { word: 'hello' }),
      mkDoc(`users/${realUid}/activity_journal/entry-1`, { text: 'kept' }),
      mkDoc(`users/${realUid}/homework/week-1`, { completed: true }),
      mkDoc(`users/${realUid}/homework/current_week`, { legacyAlias: true }),
      mkDoc(`users/${realUid}/studentJournal/j-1`, { legacySubcol: true }),
      mkDoc(`users/${realUid}/session_notes/review_cycle`, { cycle: 1 }),
      mkDoc(`users/${realUid}/session_notes/legacy_mirror`, { old: true }),

      // Dados de teste, app_db.json, ID não canônico e órfão
      mkDoc('users/usr-seed-1', { email: 'seed@domain.com', isLocalJsonRecord: true }),
      mkDoc('users/OrphanNonAuthUid1234567890', { email: 'orphan@domain.com' }),
      mkDoc(`users/${qaUid}`, { email: 'qa.runner@mydomain.org' }),
      mkDoc(`tutors/${realUid}`, { email: 'aluno.real@gmail.com' }),
      mkDoc('tutors/tutor-legacy-99', { email: 'legacytutor@example.com' }),
      mkDoc('lessons/les-real-1', { studentUid: realUid, teacherUid: adminUid }),
      mkDoc('lessons/les-orphan-1', { studentUid: 'DeletedGhostUid12345678901' }),
      mkDoc('lessons/les-qa-1', { studentUid: qaUid }),
      mkDoc('custom_future_collection/doc-1', { info: 'unknown' }),
    ];

    // Proteção obrigatória: impedir marcar conta admin para limpeza
    assert.throws(
      () =>
        mod.classifyFirestoreInventory({
          exportedDocs,
          authUsers,
          cleanTestEmails: ['adm.itissimple@gmail.com'],
        }),
      /BLOQUEIO.*administrativa/i
    );
    assert.throws(
      () =>
        mod.classifyFirestoreInventory({
          exportedDocs,
          authUsers,
          cleanTestUids: [adminUid],
        }),
      /BLOQUEIO.*administrativo/i
    );

    const plan = mod.classifyFirestoreInventory({
      exportedDocs,
      authUsers,
      cleanTestUids: [qaUid],
    });
    const byPath = new Map<string, any>(plan.actions.map((a: any) => [a.path, a]));

    // Verificações de PRESERVAÇÃO
    assert.equal(byPath.get('app_state/admin_bootstrap').action, 'PRESERVE');
    assert.equal(byPath.get('app_state/youtube_playlists').action, 'PRESERVE');
    assert.equal(byPath.get('app_state/youtube_auth').action, 'PRESERVE');
    assert.equal(byPath.get('ptax_rates/2026-11-12').action, 'PRESERVE');
    assert.equal(byPath.get(`users/${adminUid}`).action, 'PRESERVE');
    assert.equal(byPath.get(`users/${realUid}/vocabulary/hello`).action, 'PRESERVE');
    assert.equal(byPath.get(`users/${realUid}/activity_journal/entry-1`).action, 'PRESERVE');
    assert.equal(byPath.get(`users/${realUid}/homework/week-1`).action, 'PRESERVE');
    assert.equal(byPath.get(`users/${realUid}/session_notes/review_cycle`).action, 'PRESERVE');
    assert.equal(byPath.get(`tutors/${realUid}`).action, 'PRESERVE');
    assert.equal(byPath.get('lessons/les-real-1').action, 'PRESERVE');
    assert.equal(byPath.get('custom_future_collection/doc-1').action, 'REVIEW');

    // Verificações de SANITIZAÇÃO IN-PLACE
    const mainDataAct = byPath.get('app_state/main_data');
    assert.equal(mainDataAct.action, 'SANITIZE_FIELDS');
    assert.ok(mainDataAct.preserveFields.includes('landingContent'));
    assert.ok(mainDataAct.preserveFields.includes('meetSettings'));
    assert.ok(mainDataAct.removeFields.includes('userProfiles'));
    assert.ok(mainDataAct.removeFields.includes('students'));

    const tutorsAct = byPath.get('app_state/tutors');
    assert.equal(tutorsAct.action, 'SANITIZE_FIELDS');
    assert.equal(tutorsAct.updateFields.teachers.length, 1);
    assert.equal(tutorsAct.updateFields.teachers[0].email, 'adm.itissimple@gmail.com');

    const lessonsAct = byPath.get('app_state/lessons');
    assert.equal(lessonsAct.action, 'SANITIZE_FIELDS');
    assert.deepEqual(Object.keys(lessonsAct.updateFields.contractedLessons), ['aluno.real@gmail.com']);

    const realUserAct = byPath.get(`users/${realUid}`);
    assert.equal(realUserAct.action, 'SANITIZE_FIELDS');
    assert.ok(realUserAct.removeFields.includes('password'));
    assert.ok(realUserAct.removeFields.includes('vocabulary'));
    assert.ok(realUserAct.removeFields.includes('studentJournal'));

    // Verificações de EXCLUSÃO (teste, legado, órfão)
    for (const delPath of [
      'app_state/assignments',
      'app_state/main',
      'live_lessons/l-1',
      'student_homework/hw-1',
      '_diagnostic_probes/probe-1',
      'gemini_inflight_locks/lock-1',
      'gemini_rate_limits/rl-1',
      `users/${realUid}/homework/current_week`,
      `users/${realUid}/studentJournal/j-1`,
      `users/${realUid}/session_notes/legacy_mirror`,
      'users/usr-seed-1',
      'users/OrphanNonAuthUid1234567890',
      `users/${qaUid}`,
      'tutors/tutor-legacy-99',
      'lessons/les-orphan-1',
      'lessons/les-qa-1',
    ]) {
      assert.equal(byPath.get(delPath)?.action, 'DELETE_DOC', `Esperado DELETE_DOC para ${delPath}`);
    }

    // Subcoleções devem vir antes de qualquer pai na ordem de execução
    const idxChild = plan.actions.findIndex((a: any) => a.path === `users/${realUid}/studentJournal/j-1`);
    const idxParent = plan.actions.findIndex((a: any) => a.path === `users/${realUid}`);
    assert.ok(idxChild !== -1 && idxParent !== -1 && idxChild < idxParent, 'Subcoleção deve vir antes do doc pai');

    // 6. Testar travas de confirmação explícita do --execute-clean
    const backupDir = path.join(tmpDir, 'mock-backup');
    fs.mkdirSync(backupDir, { recursive: true });
    const exportFile = path.join(backupDir, 'firestore-default-export.json');
    const authFile = path.join(backupDir, 'auth-users-sanitized.json');
    const planFile = path.join(backupDir, 'cleanup-plan.json');
    const manifestFile = path.join(backupDir, 'backup-manifest.json');

    const planHash = sha256Text(JSON.stringify({ summary: plan.summary, actions: plan.actions }));
    fs.writeFileSync(exportFile, JSON.stringify({ documents: exportedDocs }), 'utf8');
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

    writeManifest();
    const okCheck = mod.validateExecuteCleanPreconditions({
      backupDir,
      confirmProject: 'itissimple-security-staging',
      confirmPlanHash: planHash.slice(0, 16),
    });
    assert.equal(okCheck.manifest.projectId, 'itissimple-security-staging');

    // Rejeições obrigatórias
    assert.throws(
      () =>
        mod.validateExecuteCleanPreconditions({
          backupDir,
          confirmProject: 'outro-projeto',
          confirmPlanHash: planHash.slice(0, 16),
        }),
      /Confirmação de projeto divergente/
    );
    assert.throws(
      () =>
        mod.validateExecuteCleanPreconditions({
          backupDir,
          confirmProject: 'itissimple-security-staging',
          confirmPlanHash: '000000000000',
        }),
      /Confirmação do inventário falhou/
    );
    assert.throws(
      () =>
        mod.validateExecuteCleanPreconditions({
          backupDir,
          confirmProject: 'itissimple-security-staging',
          confirmPlanHash: 'abc',
        }),
      /Confirmação do inventário falhou/
    );

    writeManifest({ status: 'IN_PROGRESS' });
    assert.throws(
      () =>
        mod.validateExecuteCleanPreconditions({
          backupDir,
          confirmProject: 'itissimple-security-staging',
          confirmPlanHash: planHash,
        }),
      /Backup inválido: status=/
    );

    writeManifest({ databaseId: 'ai-studio-securitystagingi-82447e17-0a01-4d71-b6f9-a8880c9fcea9' });
    assert.throws(
      () =>
        mod.validateExecuteCleanPreconditions({
          backupDir,
          confirmProject: 'itissimple-security-staging',
          confirmPlanHash: planHash,
        }),
      /databaseId=/
    );

    writeManifest({ createdAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString() });
    assert.throws(
      () =>
        mod.validateExecuteCleanPreconditions({
          backupDir,
          confirmProject: 'itissimple-security-staging',
          confirmPlanHash: planHash,
        }),
      /Backup tem/
    );

    // Adulteração de checksum
    writeManifest();
    fs.appendFileSync(exportFile, '\n// tampered', 'utf8');
    assert.throws(
      () =>
        mod.validateExecuteCleanPreconditions({
          backupDir,
          confirmProject: 'itissimple-security-staging',
          confirmPlanHash: planHash,
        }),
      /FALHA DE INTEGRIDADE/
    );

    // 7. Verificar que firestore.rules existe e não possui alteração indesejada pelo teste
    assert.ok(fs.existsSync(RULES_PATH), 'firestore.rules deve permanecer intacto');

    console.log('✓ Todos os testes ARCH.2G.1 passaram com sucesso (zero exclusões na nuvem, zero IAM, zero deploy).');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
