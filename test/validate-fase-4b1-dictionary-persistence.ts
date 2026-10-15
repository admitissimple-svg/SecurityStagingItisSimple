/**
 * TEST SUITE: FASE 4B.1 — CORREÇÃO DE IDENTIDADE E PERSISTÊNCIA DO MY DICTIONARY
 * Ambiente Exclusivo: itissimple-security-staging (default)
 *
 * Cobertura Completa dos 15 Cenários de Teste:
 * 1. Professora Skull Bee registra "Blasting" para Lala.
 * 2. Gravação destinada exclusivamente ao UID canônico da Lala.
 * 3. Nenhuma gravação no UID da Skull Bee.
 * 4. Rejeição de identidade ambígua (422).
 * 5. Rejeição de professora sem vínculo autorizado com a aluna (403).
 * 6. Persistência confirmada antes do estado de sucesso.
 * 7. Falha de persistência não gera falso sucesso.
 * 8. Repetição da operação não duplica a palavra.
 * 9. Apenas palavras New Word (Alt+W) entram no My Dictionary.
 * 10. Itens Pronounce / Correct / Incorrect não entram sozinhos.
 * 11. Recuperação somente leitura de dados legados comprovados.
 * 12. Registros canônicos não são sobrescritos por legados.
 * 13. Estado do dicionário reinicializado no logout.
 * 14. Isolamento estrito entre contas no chaveamento de sessão.
 * 15. Preservação estrita de practiceCount e lastPracticedAt.
 */

import {
  isValidCanonicalUid,
  resolveCanonicalStudentIdentity,
  saveStudentVocabularyToFirestoreServer,
  fetchStudentVocabularyFromFirestoreServer,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';

import {
  extractNotesMarkings,
} from '../src/utils/pedagogicalTransformer';

import {
  parseNotesHtml,
} from '../src/utils/notesHtmlParser';

import {
  syncSessionVocabularyToStudentDictionary,
} from '../src/utils/sessionVocabularySync';

import {
  cacheVocabularyLocally,
  getCachedLocalVocabulary,
  clearAllLocalPersistenceCaches,
  consolidateDictionaryEntries,
} from '../src/utils/studentPersistence';

import type { StudentDictionaryEntry, EnglishLevel } from '../src/types';

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

// In-Memory Mock Firestore for isolated tests
class MockDocRef {
  constructor(public id: string, private store: Map<string, any>, private parentPath: string) {}

  async get() {
    const key = `${this.parentPath}/${this.id}`;
    const data = this.store.get(key);
    return {
      id: this.id,
      exists: Boolean(data),
      data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
    };
  }

  async set(data: any, options?: { merge?: boolean }) {
    const key = `${this.parentPath}/${this.id}`;
    const existing = this.store.get(key) || {};
    const merged = options?.merge ? { ...existing, ...JSON.parse(JSON.stringify(data)) } : JSON.parse(JSON.stringify(data));
    this.store.set(key, merged);
  }

  collection(subName: string) {
    return new MockCollectionRef(`${this.parentPath}/${this.id}/${subName}`, this.store);
  }
}

class MockCollectionRef {
  constructor(public path: string, private store: Map<string, any>) {}

  doc(id: string) {
    return new MockDocRef(id, this.store, this.path);
  }

  where(field: string, op: string, value: any) {
    return {
      get: async () => {
        const docs: any[] = [];
        for (const [k, v] of this.store.entries()) {
          // Must directly belong to this collection path
          const prefix = `${this.path}/`;
          if (k.startsWith(prefix)) {
            const remainder = k.substring(prefix.length);
            if (!remainder.includes('/')) {
              if (op === '==' && v && v[field] === value) {
                docs.push({
                  id: remainder,
                  data: () => JSON.parse(JSON.stringify(v)),
                });
              }
            }
          }
        }
        return {
          empty: docs.length === 0,
          docs,
          forEach: (fn: (doc: any) => void) => docs.forEach(fn),
        };
      },
    };
  }

  async get() {
    const docs: any[] = [];
    const prefix = `${this.path}/`;
    for (const [k, v] of this.store.entries()) {
      if (k.startsWith(prefix)) {
        const remainder = k.substring(prefix.length);
        if (!remainder.includes('/')) {
          docs.push({
            id: remainder,
            data: () => JSON.parse(JSON.stringify(v)),
          });
        }
      }
    }
    return {
      empty: docs.length === 0,
      docs,
      forEach: (fn: (doc: any) => void) => docs.forEach(fn),
    };
  }
}

class MockFirestoreInstance {
  public store = new Map<string, any>();
  public projectId = 'itissimple-security-staging';

  collection(name: string) {
    return new MockCollectionRef(name, this.store);
  }
}

async function runFase4B1TestSuite() {
  console.log('=========================================================================');
  console.log(' TESTES DE VALIDAÇÃO: FASE 4B.1 — IDENTIDADE E PERSISTÊNCIA DO MY DICTIONARY');
  console.log(' PROJETO EXCLUSIVO: itissimple-security-staging (default)');
  console.log('=========================================================================\n');

  const mockDb = new MockFirestoreInstance();
  setFirebaseAdminFirestoreForTesting(mockDb as any);

  // Setup canonical identities
  const SKULL_BEE_UID = 'uid_skullbee_teacher_456';
  const SKULL_BEE_EMAIL = 'laviniafofafc@gmail.com';

  const LALA_CANONICAL_UID = 'uid_lala_student_123';
  const LALA_EMAIL = 'lavistorekids@gmail.com';
  const LALA_SYNTHETIC_UID = 'usr-lala-lavistorekids-gmail-com';

  const OTHER_STUDENT_UID = 'uid_other_student_789';
  const OTHER_STUDENT_EMAIL = 'other.student@test.com';

  const TRIAL_LESSON_ID = 'lesson_trial_20261014';

  // Seed Firestore
  await mockDb.collection('users').doc(SKULL_BEE_UID).set({
    uid: SKULL_BEE_UID,
    email: SKULL_BEE_EMAIL,
    role: 'teacher',
    name: 'Skull Bee',
  });

  await mockDb.collection('users').doc(LALA_CANONICAL_UID).set({
    uid: LALA_CANONICAL_UID,
    email: LALA_EMAIL,
    role: 'student',
    name: 'Lala',
    assignedNativeFriendUID: SKULL_BEE_UID,
  });

  await mockDb.collection('lessons').doc(TRIAL_LESSON_ID).set({
    id: TRIAL_LESSON_ID,
    teacherUid: SKULL_BEE_UID,
    teacherEmail: SKULL_BEE_EMAIL,
    studentUid: LALA_CANONICAL_UID,
    studentEmail: LALA_EMAIL,
    title: 'Trial Lesson',
    startDateTime: '2026-10-14T14:00:00Z',
  });

  // -------------------------------------------------------------------------
  // 1 & 2 & 3. Skull Bee registra "Blasting" para Lala -> grava estritamente no UID de Lala
  // -------------------------------------------------------------------------
  console.log('--- 1, 2 & 3. Persistência de "Blasting" por Skull Bee para Lala ---');

  const identityRes = await resolveCanonicalStudentIdentity({
    caller: { uid: SKULL_BEE_UID, email: SKULL_BEE_EMAIL, role: 'teacher' },
    studentEmail: LALA_EMAIL,
    studentUid: LALA_SYNTHETIC_UID, // Frontend sent synthetic ID
    lessonId: TRIAL_LESSON_ID,
  });

  assert(identityRes.authorized === true, '1. Skull Bee é autorizada para a aula Trial com Lala');
  assert(identityRes.canonicalStudentUid === LALA_CANONICAL_UID, '2. UID canônico resolvido é exatamente o de Lala (uid_lala_student_123)');
  assert(identityRes.canonicalStudentUid !== SKULL_BEE_UID, '3. UID resolvido NUNCA é o da professora Skull Bee');

  // Perform persistence
  const entryBlasting = {
    word: 'Blasting',
    definitionEn: 'Playing music or sound at very high volume.',
    exampleSentenceEn: 'The music was blasting through the speakers.',
    source: 'live_lesson',
    sourceActivityName: 'Native Friends Notes (Trial)',
    practiceCount: 0,
  };

  const saveOk = await saveStudentVocabularyToFirestoreServer(
    identityRes.canonicalStudentUid,
    [entryBlasting],
    LALA_EMAIL
  );

  assert(saveOk === true, 'Gravação no Firestore Server concluída com sucesso');

  // Verify write destination in mockDb
  const lalaDoc = await mockDb.collection('users').doc(LALA_CANONICAL_UID).get();
  assert(lalaDoc.exists, 'Documento canonical da Lala existe');
  assert(
    Array.isArray(lalaDoc.data()?.vocabulary) &&
    lalaDoc.data()?.vocabulary.some((v: any) => v.word.toLowerCase() === 'blasting'),
    '2. Palavra "Blasting" persistida no array users/{canonicalUid}.vocabulary de Lala'
  );

  const lalaSubDoc = await mockDb.collection('users').doc(LALA_CANONICAL_UID).collection('vocabulary').doc('blasting').get();
  assert(lalaSubDoc.exists, '2. Palavra "Blasting" persistida na subcoleção users/{canonicalUid}/vocabulary/blasting');

  // Confirm NO write in Skull Bee doc
  const teacherDoc = await mockDb.collection('users').doc(SKULL_BEE_UID).get();
  const teacherVocab = teacherDoc.data()?.vocabulary;
  assert(
    !teacherVocab || !teacherVocab.some((v: any) => v.word.toLowerCase() === 'blasting'),
    '3. Nenhuma gravação no documento da professora Skull Bee'
  );

  // -------------------------------------------------------------------------
  // 4. Rejeição de Identidade Ambígua
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Rejeição de Identidade Ambígua ---');

  const ambiguousRes = await resolveCanonicalStudentIdentity({
    caller: { uid: SKULL_BEE_UID, email: SKULL_BEE_EMAIL, role: 'teacher' },
    studentEmail: 'unknown.ghost@domain.com',
    studentUid: 'usr-synthetic-unknown',
    lessonId: undefined,
  });

  assert(ambiguousRes.authorized === false, '4. Identidade ambígua/desconhecida é rejeitada');
  assert(ambiguousRes.statusCode === 403 || ambiguousRes.statusCode === 422, '4. Código de erro explícito retornado (403/422)');
  assert(!ambiguousRes.canonicalStudentUid, '4. Nenhum UID retornado para identidade ambígua');

  // -------------------------------------------------------------------------
  // 5. Rejeição de Professora sem Vínculo Autorizado com a Aluna
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Rejeição de Professora Sem Vínculo Autorizado ---');

  const rogueTeacherUid = 'uid_rogue_teacher_999';
  const unauthorizedRes = await resolveCanonicalStudentIdentity({
    caller: { uid: rogueTeacherUid, email: 'rogue@teacher.com', role: 'teacher' },
    studentEmail: LALA_EMAIL,
    studentUid: LALA_CANONICAL_UID,
    lessonId: undefined,
  });

  assert(unauthorizedRes.authorized === false, '5. Professora sem vínculo autorizado é bloqueada');
  assert(unauthorizedRes.statusCode === 403, '5. Status 403 Forbidden retornado');

  // -------------------------------------------------------------------------
  // 6 & 7. Persistência Confirmada e Prevenção de Falso Sucesso
  // -------------------------------------------------------------------------
  console.log('\n--- 6 & 7. Persistência Confirmada & Prevenção de Falso Sucesso ---');

  // Test invalid synthetic UID passed to server persistence directly
  let threwOnInvalidUid = false;
  try {
    await saveStudentVocabularyToFirestoreServer(LALA_SYNTHETIC_UID, [entryBlasting], LALA_EMAIL);
  } catch (err: any) {
    threwOnInvalidUid = true;
    assert(err.message.includes('Rejected non-canonical student UID'), '7. Rejeição explícita de UID sintético no Firestore Server');
  }
  assert(threwOnInvalidUid === true, '6 & 7. Persistência sem UID canônico interrompida com erro sem gerar falso sucesso');

  // -------------------------------------------------------------------------
  // 8. Idempotência: Repetição da Operação Não Duplica a Palavra
  // -------------------------------------------------------------------------
  console.log('\n--- 8. Repetição da Operação Não Duplica a Palavra ---');

  await saveStudentVocabularyToFirestoreServer(
    LALA_CANONICAL_UID,
    [entryBlasting, entryBlasting], // Double insert
    LALA_EMAIL
  );

  const lalaWords = await fetchStudentVocabularyFromFirestoreServer(LALA_CANONICAL_UID, LALA_EMAIL);
  const blastingCount = lalaWords.filter((w) => w.word.toLowerCase() === 'blasting').length;
  assert(blastingCount === 1, '8. Palavra "Blasting" aparece exatamente 1 vez (sem duplicatas)');

  // -------------------------------------------------------------------------
  // 9 & 10. Integridade Pedagógica: Somente New Word (Alt+W) entra no dicionário
  // -------------------------------------------------------------------------
  const sampleRawNotes = `
  <div style="font-family: sans-serif;">
    <p><strong>Native Friend In-Session Notes</strong></p>
    <p>Topic: Trial</p>
    <div>
      <span class="inline-coaching-tag new-word-tag font-bold" data-tag-type="new-word" contenteditable="false" style="color: #1d4ed8;">✦ New Word</span>&nbsp;Blasting
    </div>
    <div>
      <span class="inline-coaching-tag pronounce-tag font-bold" data-tag-type="pronounce" contenteditable="false" style="color: #7e22ce;">🎯 Pronounce</span>&nbsp;Articulate
    </div>
    <div>
      <span class="inline-coaching-tag incorrect-tag font-bold" data-tag-type="incorrect" contenteditable="false" style="color: #b91c1c;">✗</span>&nbsp;I go there yesterday
    </div>
    <div>
      <span class="inline-coaching-tag correct-tag font-bold" data-tag-type="correct" contenteditable="false" style="color: #15803d;">✓</span>&nbsp;I went there yesterday
    </div>
  </div>
  `;

  const markings = extractNotesMarkings(sampleRawNotes);
  assert(markings.newWords.includes('Blasting'), '9. "Blasting" extraído como New Word');
  assert(markings.pronounceItems.includes('Articulate'), '10. "Articulate" extraído como Pronounce');

  const parsed = parseNotesHtml(sampleRawNotes);
  assert(parsed.newWords.length === 1 && parsed.newWords[0] === 'Blasting', '9. Parser HTML identifica unicamente 1 New Word ("Blasting")');
  assert(parsed.pronounceItems.length === 1 && parsed.pronounceItems[0] === 'Articulate', '10. Parser HTML identifica unicamente 1 Pronounce ("Articulate")');
  assert(parsed.errors.length === 1, 'Parser HTML identifica erro sem contaminar palavras novas');

  // Verify sync function only adds New Word to returned dictionary entries
  const syncedCandidates = await syncSessionVocabularyToStudentDictionary({
    studentUid: LALA_CANONICAL_UID,
    studentEmail: LALA_EMAIL,
    rawNotes: sampleRawNotes,
    topic: 'Trial',
    teacherName: 'Skull Bee',
    lessonId: TRIAL_LESSON_ID,
  });

  const syncedWords = syncedCandidates.map((c) => c.word.toLowerCase());
  assert(syncedWords.includes('blasting'), '9. "Blasting" (Alt+W) incluído no My Dictionary');
  assert(!syncedWords.includes('articulate'), '10. "Articulate" (Alt+P exclusivo) NÃO é incluído no My Dictionary');
  assert(!syncedWords.includes('i go there yesterday'), '10. Itens de correção (Alt+N/Alt+Y) NÃO entram no My Dictionary');

  // Check origin metadata
  const blastingEntry = syncedCandidates.find((c) => c.word.toLowerCase() === 'blasting');
  assert(Boolean(blastingEntry?.origins?.[0]?.activityName?.includes('Native Friends Notes')), 'Origem identificada como Native Friends Notes');
  assert(blastingEntry?.origins?.[0]?.lessonId === TRIAL_LESSON_ID, 'ID da aula preservado no histórico de origens');

  // -------------------------------------------------------------------------
  // 11 & 12. Compatibilidade com Dados Legados (Read-Only) & Precedência Canônica
  // -------------------------------------------------------------------------
  console.log('\n--- 11 & 12. Recuperação Somente Leitura de Dados Legados & Precedência Canônica ---');

  const LEGACY_STUDENT_UID = 'uid_student_legacy_555';
  const LEGACY_STUDENT_EMAIL = 'student.legacy@example.com';
  const LEGACY_DOC_ID = 'usr-student-legacy-example-com';

  // Seed legacy doc without canonical doc having vocabulary
  await mockDb.collection('users').doc(LEGACY_STUDENT_UID).set({
    uid: LEGACY_STUDENT_UID,
    email: LEGACY_STUDENT_EMAIL,
    role: 'student',
  });

  await mockDb.collection('users').doc(LEGACY_DOC_ID).set({
    id: LEGACY_DOC_ID,
    email: LEGACY_STUDENT_EMAIL,
    uid: LEGACY_STUDENT_UID,
    vocabulary: [
      {
        word: 'Pivotal',
        definitionEn: 'Of crucial importance in relation to the development or success of something else.',
        practiceCount: 3,
        lastPracticedAt: '2026-09-01T10:00:00Z',
      },
    ],
  });

  // Fetch legacy data
  const legacyRecovered = await fetchStudentVocabularyFromFirestoreServer(LEGACY_STUDENT_UID, LEGACY_STUDENT_EMAIL);
  assert(
    legacyRecovered.some((w) => w.word.toLowerCase() === 'pivotal'),
    '11. Registro legado "Pivotal" recuperado com sucesso em modo somente leitura'
  );

  // Verify that fetchStudentVocabularyFromFirestoreServer did NOT write to canonical doc (Strictly read-only)
  const canonicalAfterRead = await mockDb.collection('users').doc(LEGACY_STUDENT_UID).get();
  assert(
    canonicalAfterRead.data()?.vocabulary === undefined,
    '11. Nenhuma migração automática foi escrita no documento canônico durante a leitura'
  );

  // Canonical Precedence: When canonical doc HAS words, legacy words never overwrite canonical words
  await mockDb.collection('users').doc(LEGACY_STUDENT_UID).set({
    vocabulary: [
      {
        word: 'Pivotal',
        definitionEn: 'Canonical superior definition of pivotal.',
        practiceCount: 5,
        lastPracticedAt: '2026-10-15T12:00:00Z',
      },
    ],
  });

  const wordsWithCanonical = await fetchStudentVocabularyFromFirestoreServer(LEGACY_STUDENT_UID, LEGACY_STUDENT_EMAIL);
  const pivotalEntry = wordsWithCanonical.find((w) => w.word.toLowerCase() === 'pivotal');
  assert(
    pivotalEntry?.definitionEn === 'Canonical superior definition of pivotal.',
    '12. Registro canônico tem estrita precedência e não é sobrescrito pelo registro legado'
  );

  // -------------------------------------------------------------------------
  // 13 & 14. Isolamento de Sessão e Reinicialização no Logout
  // -------------------------------------------------------------------------
  console.log('\n--- 13 & 14. Isolamento de Sessão e Reinicialização no Logout ---');

  // Cache test for Lala
  cacheVocabularyLocally(LALA_CANONICAL_UID, LALA_EMAIL, [entryBlasting as any]);
  const cachedLala = getCachedLocalVocabulary(LALA_CANONICAL_UID, LALA_EMAIL);
  assert(cachedLala.length === 1 && cachedLala[0].word === 'Blasting', 'Cache em memória ativo para Lala');

  // Clear caches on logout
  clearAllLocalPersistenceCaches();
  const cachedAfterLogout = getCachedLocalVocabulary(LALA_CANONICAL_UID, LALA_EMAIL);
  assert(cachedAfterLogout.length === 0, '13. Cache local de vocabulário completamente reinicializado após logout');

  // Cross-account isolation check
  cacheVocabularyLocally(LALA_CANONICAL_UID, LALA_EMAIL, [entryBlasting as any]);
  const otherCached = getCachedLocalVocabulary(OTHER_STUDENT_UID, OTHER_STUDENT_EMAIL);
  assert(otherCached.length === 0, '14. Estudante Other Student não acessa cache de vocabulário da Lala');

  // -------------------------------------------------------------------------
  // 15. Preservação de practiceCount e lastPracticedAt
  // -------------------------------------------------------------------------
  console.log('\n--- 15. Preservação de practiceCount e lastPracticedAt ---');

  const initialEntry: StudentDictionaryEntry = {
    id: 'dict_blasting_1',
    word: 'Blasting',
    definitionEn: 'Original rich definition',
    exampleSentenceEn: 'The radio was blasting.',
    practiceCount: 7,
    lastPracticedAt: '2026-10-15T10:00:00Z',
  };

  const incomingUpdate: StudentDictionaryEntry = {
    id: 'dict_blasting_2',
    word: 'Blasting',
    definitionEn: '', // Blank or incomplete
    practiceCount: 0, // Incomplete / zeroed counter from incoming notes
    lastPracticedAt: undefined,
  };

  const consolidated = consolidateDictionaryEntries([initialEntry], [incomingUpdate]);
  const blastResult = consolidated.find((w) => w.word.toLowerCase() === 'blasting');

  assert(blastResult?.practiceCount === 7, '15. practiceCount (7) preservado intacto sem decréscimo');
  assert(blastResult?.lastPracticedAt === '2026-10-15T10:00:00Z', '15. lastPracticedAt preservado intacto');
  assert(blastResult?.definitionEn === 'Original rich definition', 'Definição mais rica preservada intacta');

  // Cleanup
  resetFirebaseAdminFirestoreForTesting();

  console.log('\n=========================================================================');
  console.log(` RESULTADO FINAL: ${passed} PASS, ${failed} FAIL`);
  console.log('=========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runFase4B1TestSuite().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
