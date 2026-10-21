import fs from 'fs';
import path from 'path';
import {
  isValidCanonicalUid,
  isGenericTutorId,
  toDeterministicCanonicalStudentUid,
  areSameTutor,
} from '../src/utils/tutorConsolidation';

function assert(condition: any, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runConsolidationValidation() {
  console.log('=========================================================================');
  console.log(' TEST SUITE: CONSOLIDAÇÃO DE IDENTIDADE CANÔNICA (REGRAS OBRIGATÓRIAS)    ');
  console.log(' Projeto: itissimple-security-staging | Banco: (default)                 ');
  console.log('=========================================================================');

  // Rule 1 & 3: Never generate UIDs from emails, Firebase Auth is the only authority
  console.log('\n--- 1. Proibição Absoluta de Geração de UIDs a partir de E-mails ---');
  const dummyEmails = [
    'student@example.com',
    'sarah.native@itissimple.com',
    'user.test@gmail.com',
    'admin@simple.org',
  ];
  for (const email of dummyEmails) {
    const res = toDeterministicCanonicalStudentUid(email);
    assert(res === '', `toDeterministicCanonicalStudentUid("${email}") returns empty string (never generates synthetic UID)`);
  }

  // Rule 3: Valid canonical UIDs are accepted; synthetic UIDs are strictly rejected
  console.log('\n--- 2. Validação Estrita de UID Canônico (isValidCanonicalUid) ---');
  const validCanonicalUids = [
    'kL890123456789abcdefghij',
    'AIzaSyB1234567890abcdef',
    'student_firebase_uid_staging_99',
    'aZ890qWklmNOPQRSTUVwxyz12',
  ];
  for (const uid of validCanonicalUids) {
    assert(isValidCanonicalUid(uid) === true, `Authentic canonical UID "${uid}" is accepted`);
  }

  const forbiddenSyntheticUids = [
    'usr-student-gmail-com',
    'stu_student-gmail-com',
    'tutor-sarah-gmail-com',
    'st-1788181232049',
    'teacher-1788181232049',
    'lesson-1788181232049',
    'usr-1788181232049',
    'user-default',
    'anonymous_student',
    'student@example.com',
  ];
  for (const uid of forbiddenSyntheticUids) {
    assert(isValidCanonicalUid(uid) === false, `Forbidden synthetic identifier "${uid}" is rejected`);
  }

  // Rule 4: Never associate records solely by email coincidence
  console.log('\n--- 3. Desassociação por Mera Coincidência de E-mail (areSameTutor) ---');
  const tutorA = {
    id: 'uid_canonical_11111111111111',
    uid: 'uid_canonical_11111111111111',
    email: 'shared@example.com',
    name: 'Tutor One',
  };
  const tutorB = {
    id: 'uid_canonical_22222222222222',
    uid: 'uid_canonical_22222222222222',
    email: 'shared@example.com',
    name: 'Tutor Two',
  };
  assert(
    areSameTutor(tutorA, tutorB) === false,
    'areSameTutor does NOT associate distinct canonical UIDs solely because of identical email'
  );

  const tutorASame = {
    id: 'uid_canonical_11111111111111',
    uid: 'uid_canonical_11111111111111',
    email: 'shared@example.com',
    name: 'Tutor One Updated',
  };
  assert(
    areSameTutor(tutorA, tutorASame) === true,
    'areSameTutor associates records with identical canonical UID'
  );

  // Rule 7: serverFirestore.ts must never invoke adminAuth.createUser
  console.log('\n--- 4. Proibição de Criação Automática de Contas (adminAuth.createUser) ---');
  const serverFirestoreContent = fs.readFileSync(path.join(process.cwd(), 'src/serverFirestore.ts'), 'utf-8');
  assert(
    !serverFirestoreContent.includes('adminAuth.createUser'),
    'src/serverFirestore.ts does NOT call adminAuth.createUser'
  );
  assert(
    !serverFirestoreContent.includes('toDeterministicCanonicalStudentUid'),
    'src/serverFirestore.ts does NOT reference toDeterministicCanonicalStudentUid'
  );

  // Rule 2 & 8: serverApp.ts and src/serverFirestore.ts database is strictly (default)
  console.log('\n--- 5. Firestore (default) como Fonte Única de Verdade ---');
  const serverAppContent = fs.readFileSync(path.join(process.cwd(), 'serverApp.ts'), 'utf-8');
  assert(
    serverAppContent.includes("process.env.FIREBASE_DATABASE_ID = '(default)'"),
    'serverApp.ts binds FIREBASE_DATABASE_ID to (default)'
  );
  assert(
    serverAppContent.includes("process.env.VITE_FIREBASE_DATABASE_ID = '(default)'"),
    'serverApp.ts binds VITE_FIREBASE_DATABASE_ID to (default)'
  );

  // Rule 9: Removal of synthetic UID generation in registration and popover
  console.log('\n--- 6. Ausência de Geração Sintética de UIDs em Cadastros ---');
  assert(
    !serverAppContent.includes('usr-${cleanEmail'),
    'serverApp.ts does not generate usr-${cleanEmail} synthetic IDs'
  );
  const headerMessagesPopoverContent = fs.readFileSync(path.join(process.cwd(), 'src/components/HeaderMessagesPopover.tsx'), 'utf-8');
  assert(
    !headerMessagesPopoverContent.includes('usr-${studentEmail'),
    'HeaderMessagesPopover.tsx does not generate usr-${studentEmail} synthetic fallbacks'
  );
  assert(
    !headerMessagesPopoverContent.includes('tutor-${targetEmail'),
    'HeaderMessagesPopover.tsx does not generate tutor-${targetEmail} synthetic fallbacks'
  );

  // Rule 5 & 6: Data preservation
  console.log('\n--- 7. Preservação de Dados de Produção e CMS ---');
  const appDb = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/data/app_db.json'), 'utf-8'));
  assert(Boolean(appDb.landingContent?.heroHeadlineStart), 'Landing content CMS preserved');
  assert(Boolean(appDb.routinesByDay?.monday), 'Pedagogical routine Monday preserved');
  assert(Boolean(appDb.routinesByDay?.friday), 'Pedagogical routine Friday preserved');
  assert(Boolean(appDb.dictionary), 'Curated dictionary preserved');
  assert(Boolean(appDb.youtubePlaylists), 'YouTube playlists preserved');

  console.log('\n=========================================================================');
  console.log(' TOTAL: TODAS AS REGRAS OBRIGATÓRIAS FORAM VALIDADAS COM SUCESSO!       ');
  console.log('=========================================================================');
  process.exit(0);
}

runConsolidationValidation().catch((err) => {
  console.error('Fatal error during validation:', err);
  process.exit(1);
});
