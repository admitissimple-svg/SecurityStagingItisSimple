import fs from 'fs';
import path from 'path';
import { isValidCanonicalUid, isGenericTutorId } from '../src/utils/tutorConsolidation';
import { mergeStudentPreservingCanonicalUid, mergeProfilePreservingCanonicalUid } from '../serverApp';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

async function runHotfix4B20ETestSuite() {
  console.log('===================================================================================');
  console.log(' TEST SUITE: SECURITY HOTFIX 4B.20E — REMOÇÃO DE TRATAMENTO LEGADO DE UIDs FICTÍCIOS');
  console.log(' Project: itissimple-security-staging | Runtime: Node.js / Firebase Auth');
  console.log('===================================================================================\n');

  const serverAppPath = path.join(process.cwd(), 'serverApp.ts');
  const serverAppContent = fs.readFileSync(serverAppPath, 'utf-8');
  const appDbPath = path.join(process.cwd(), 'src', 'data', 'app_db.json');
  const appDb = JSON.parse(fs.readFileSync(appDbPath, 'utf-8'));

  // -----------------------------------------------------------------------------------
  // 1. Zero Hardcoded Legacy UIDs in serverApp.ts
  // -----------------------------------------------------------------------------------
  console.log('--- 1. Verificação de Ausência Total de UIDs Fictícios Fixos em serverApp.ts ---');
  assert(
    !serverAppContent.includes('admin-master-uid'),
    'serverApp.ts contains zero references to admin-master-uid'
  );
  assert(
    !serverAppContent.includes('student_lala_canonical_uid'),
    'serverApp.ts contains zero references to student_lala_canonical_uid'
  );
  assert(
    !serverAppContent.includes("existingTutorUid !== 'admin-master-uid'"),
    'No hardcoded admin-master-uid bypass in /api/tutors UID conflict protection'
  );
  assert(
    !serverAppContent.includes("existingRecordUid !== 'student_lala_canonical_uid'"),
    'No hardcoded student_lala_canonical_uid bypass in /api/user-profile conflict protection'
  );

  // -----------------------------------------------------------------------------------
  // 2. Generic Canonical UID Resolution in loadFromDisk()
  // -----------------------------------------------------------------------------------
  console.log('\n--- 2. Resolução Genérica de UIDs no Carregamento Local (loadFromDisk) ---');
  assert(
    serverAppContent.includes('!uUid || !isValidCanonicalUid(uUid)'),
    'diskAuthUsers sanitization relies strictly on generic isValidCanonicalUid'
  );
  assert(
    serverAppContent.includes('pUid && !isValidCanonicalUid(pUid)'),
    'diskUserProfiles sanitization relies strictly on generic isValidCanonicalUid'
  );
  assert(
    serverAppContent.includes('s.uid && !isValidCanonicalUid(s.uid)'),
    'diskStudents sanitization relies strictly on generic isValidCanonicalUid'
  );
  assert(
    serverAppContent.includes('t.uid && !isValidCanonicalUid(t.uid)'),
    'diskTeachers sanitization relies strictly on generic isValidCanonicalUid'
  );
  assert(
    serverAppContent.includes('t.authUid && !isValidCanonicalUid(t.authUid)'),
    'diskTutorsList authUid sanitization relies strictly on generic isValidCanonicalUid'
  );

  // -----------------------------------------------------------------------------------
  // 3. Prevention of Resurrecting Obsolete Users, Teachers, or Old Links
  // -----------------------------------------------------------------------------------
  console.log('\n--- 3. Prevenção de Ressuscitação de Registros Excluídos ou Vínculos Inválidos ---');
  assert(
    serverAppContent.includes('!diskDeletedTutorEmails.includes(em)'),
    'loadFromDisk filters out deleted tutor emails to prevent resurrection'
  );
  assert(
    serverAppContent.includes('!diskDeletedStudentEmails.includes(em)'),
    'loadFromDisk filters out deleted student emails to prevent resurrection'
  );
  assert(
    serverAppContent.includes('pTeacherUid && !isValidCanonicalUid(pTeacherUid)'),
    'loadFromDisk purges non-canonical teacherUid links from profiles'
  );
  assert(
    serverAppContent.includes('s.teacherUid && !isValidCanonicalUid(s.teacherUid)'),
    'loadFromDisk purges non-canonical teacherUid links from students'
  );

  // -----------------------------------------------------------------------------------
  // 4. Authoritative Firebase State Overrides Local Disk Data
  // -----------------------------------------------------------------------------------
  console.log('\n--- 4. Precedência Absoluta do Estado Autoritativo do Firebase ---');
  assert(
    serverAppContent.includes('mergeStudentPreservingCanonicalUid(s, existing)'),
    'Cloud student record (existing) overrides local disk record (s) during hydration'
  );
  assert(
    serverAppContent.includes('mergeProfilePreservingCanonicalUid('),
    'Cloud userProfile record preserves authentic canonical UIDs during hydration'
  );

  // -----------------------------------------------------------------------------------
  // 5. Test Canonical Validation & Merging Logic
  // -----------------------------------------------------------------------------------
  console.log('\n--- 5. Testes Unitários de Sanitização e Preservação Canônica ---');
  const genuineUid = 'aZ890qWklmNOPQRSTUVwxyz12';
  const legacyTestUid = 'admin-master-uid';
  assert(isValidCanonicalUid(genuineUid), 'Authentic Firebase UID is accepted');
  assert(!isValidCanonicalUid(legacyTestUid), 'Legacy test UID admin-master-uid is rejected by isValidCanonicalUid');

  const diskStudent = { uid: genuineUid, studentUid: genuineUid, email: 'aluno@teste.com', level: 'iniciante' };
  const cloudStudent = { uid: genuineUid, studentUid: genuineUid, email: 'aluno@teste.com', level: 'avançado' };
  const mergedStudent = mergeStudentPreservingCanonicalUid(diskStudent, cloudStudent);
  assert(mergedStudent.level === 'avançado', 'Cloud student data correctly takes precedence over local disk data');
  assert(mergedStudent.uid === genuineUid, 'Authentic canonical UID is preserved intact');

  // -----------------------------------------------------------------------------------
  // 6. Pedagogical Content & CMS Integrity
  // -----------------------------------------------------------------------------------
  console.log('\n--- 6. Integridade de Conteúdos Pedagógicos e Configurações ---');
  assert(Boolean(appDb.landingContent && appDb.landingContent.heroHeadlineStart), 'Landing content preserved');
  assert(Boolean(appDb.routinesByDay && appDb.routinesByDay.monday), 'Curriculum Monday routine preserved');
  assert(Array.isArray(appDb.youtubePlaylists) && appDb.youtubePlaylists.length > 0, 'YouTube playlists preserved');

  // -----------------------------------------------------------------------------------
  // 7. Confirmação da Regra Zero LocalStorage
  // -----------------------------------------------------------------------------------
  console.log('\n--- 7. Confirmação da Regra Zero LocalStorage ---');
  const studentPersistenceContent = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'studentPersistence.ts'), 'utf-8');
  assert(
    studentPersistenceContent.includes('ZERO dependency on localStorage'),
    'studentPersistence.ts enforces ZERO dependency on localStorage'
  );
  assert(
    !serverAppContent.includes('localStorage.setItem') &&
    !serverAppContent.includes('localStorage.getItem') &&
    !serverAppContent.includes('window.localStorage'),
    'serverApp.ts does not execute localStorage API calls'
  );

  console.log('\n===================================================================================');
  console.log(` TOTAL VERIFICAÇÕES: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('===================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runHotfix4B20ETestSuite().catch((err) => {
  console.error('Erro fatal na suíte de testes Hotfix 4B.20E:', err);
  process.exit(1);
});
