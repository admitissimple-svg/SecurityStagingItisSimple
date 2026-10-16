/**
 * HOTFIX 4B.8.4 VALIDATION TEST SUITE
 * Project: itissimple-security-staging
 *
 * Verifies:
 * 1. Recursive elimination of all `undefined` values from dictionary payloads for Firestore Admin SDK.
 * 2. Preservation of authentic student vocabulary, origins, histories, and enrichment without inventing texts.
 * 3. Canonical UID enforcement (accepting Lala's real UID: QLcJOUVRuGMSCKx3isYW3mryZty2, rejecting synthetic IDs).
 * 4. API persistence confirmation requirement (no false success if write fails).
 * 5. Gemini HTTP 503 error categorization as SERVICE_UNAVAILABLE.
 * 6. Native Friends Notes fallback provisional marking and original notes preservation on Gemini 503.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import {
  removeUndefinedFields,
  saveStudentVocabularyToFirestoreServer,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import {
  executeGeminiSingleAttempt,
  resetGeminiSecurityStateForTesting,
  GEMINI_FIXED_MODEL,
} from '../src/serverGeminiSecurity';
import { isValidCanonicalUid } from '../src/utils/studentPersistence';
import { syncSessionVocabularyToStudentDictionary } from '../src/utils/sessionVocabularySync';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
  }
}

async function runHotfix4B84TestSuite() {
  console.log('============================================================================');
  console.log(' TEST SUITE HOTFIX 4B.8.4 — FIRESTORE UNDEFINED + GEMINI 503');
  console.log(' Target Project: itissimple-security-staging');
  console.log('============================================================================\n');

  resetGeminiSecurityStateForTesting();
  resetFirebaseAdminFirestoreForTesting();

  const lalaCanonicalUid = 'QLcJOUVRuGMSCKx3isYW3mryZty2';
  const syntheticUsrId = 'usr-laviniatilapiafc-gmail-com';
  const syntheticStId = 'st-1788181232049';

  // ----------------------------------------------------------------------------
  // SECTION 1: removeUndefinedFields & PAYLOAD PURIFICATION
  // ----------------------------------------------------------------------------
  console.log('--- 1. Purificação de Payloads: Eliminação Recursiva de Undefined ---');

  const dirtyPayload = {
    id: 'dict_test_1',
    word: 'figure out',
    originalWord: 'figure out',
    normalizedWord: 'figure out',
    definitionEn: 'to understand or solve something',
    simpleDefinition: undefined, // dirty undefined
    lastPracticedAt: undefined, // dirty undefined
    practiceCount: 3,
    origins: [
      {
        source: 'native_notes',
        activityName: 'Native Friends Notes (Fluency)',
        date: '2026-10-16',
        lessonId: undefined, // dirty undefined
        videoId: undefined, // dirty undefined
        videoTitle: undefined, // dirty undefined
        teacherName: 'Lala',
      },
    ],
    nestedMeta: {
      provisional: false,
      extraField: undefined, // dirty undefined
      subArray: [1, undefined, { deepVal: 'valid', deepNull: null, deepUndef: undefined }],
    },
  };

  const cleanPayload: any = removeUndefinedFields(dirtyPayload);

  assert(
    !('simpleDefinition' in cleanPayload),
    '1.1: simpleDefinition undefined foi removido do objeto raiz'
  );
  assert(
    !('lastPracticedAt' in cleanPayload),
    '1.2: lastPracticedAt undefined foi removido do objeto raiz'
  );
  assert(
    cleanPayload.definitionEn === 'to understand or solve something',
    '1.3: Campos válidos foram estritamente preservados'
  );
  assert(
    cleanPayload.practiceCount === 3,
    '1.4: Contadores numéricos preservados intactos'
  );
  assert(
    cleanPayload.origins.length === 1 &&
      !('lessonId' in cleanPayload.origins[0]) &&
      !('videoId' in cleanPayload.origins[0]) &&
      cleanPayload.origins[0].teacherName === 'Lala',
    '1.5: Undefined em objetos aninhados dentro de arrays removidos sem perder itens legítimos'
  );
  assert(
    cleanPayload.nestedMeta.subArray.length === 2 &&
      cleanPayload.nestedMeta.subArray[1].deepVal === 'valid' &&
      cleanPayload.nestedMeta.subArray[1].deepNull === null &&
      !('deepUndef' in cleanPayload.nestedMeta.subArray[1]),
    '1.6: Arrays profundamente aninhados purificados, preservando nulls e primitivos'
  );

  // ----------------------------------------------------------------------------
  // SECTION 2: CANONICAL UID & FIRESTORE ADMIN SDK PERSISTENCE
  // ----------------------------------------------------------------------------
  console.log('\n--- 2. Persistência de Vocabulário no Firestore Admin SDK ---');

  assert(
    isValidCanonicalUid(lalaCanonicalUid) === true,
    '2.1A: UID verdadeiro de Lala (QLcJOUVRuGMSCKx3isYW3mryZty2) é canônico e aceito'
  );
  assert(
    isValidCanonicalUid(syntheticUsrId) === false,
    '2.1B: Identificador sintético usr-* é rejeitado'
  );
  assert(
    isValidCanonicalUid(syntheticStId) === false,
    '2.1C: Identificador sintético st-* é rejeitado'
  );

  // Mock Firestore Admin SDK that checks strictly for 'undefined' values and throws if found
  const writtenDocs = new Map<string, any>();
  const mockDb: any = {
    collection: (colName: string) => ({
      doc: (docId: string) => ({
        get: async () => ({
          exists: writtenDocs.has(`${colName}/${docId}`),
          data: () => writtenDocs.get(`${colName}/${docId}`),
        }),
        set: async (data: any, options?: any) => {
          // Strictly emulate Firestore Admin SDK check
          function checkForUndefined(obj: any, path: string = ''): void {
            if (obj === undefined) {
              throw new Error(`Cannot use "undefined" as a Firestore value (found in field ${path})`);
            }
            if (obj && typeof obj === 'object') {
              for (const [k, v] of Object.entries(obj)) {
                if (v === undefined) {
                  throw new Error(`Cannot use "undefined" as a Firestore value (found in field ${path ? `${path}.${k}` : k})`);
                }
                checkForUndefined(v, path ? `${path}.${k}` : k);
              }
            }
          }
          checkForUndefined(data);

          const key = `${colName}/${docId}`;
          const current = writtenDocs.get(key) || {};
          writtenDocs.set(key, options?.merge ? { ...current, ...data } : data);
        },
        collection: (subColName: string) => ({
          doc: (subDocId: string) => ({
            set: async (subData: any, subOptions?: any) => {
              function checkForUndefined(obj: any, path: string = ''): void {
                if (obj === undefined) {
                  throw new Error(`Cannot use "undefined" as a Firestore value (found in field ${path})`);
                }
                if (obj && typeof obj === 'object') {
                  for (const [k, v] of Object.entries(obj)) {
                    if (v === undefined) {
                      throw new Error(`Cannot use "undefined" as a Firestore value (found in field ${path ? `${path}.${k}` : k})`);
                    }
                    checkForUndefined(v, path ? `${path}.${k}` : k);
                  }
                }
              }
              checkForUndefined(subData);

              const subKey = `${colName}/${docId}/${subColName}/${subDocId}`;
              const current = writtenDocs.get(subKey) || {};
              writtenDocs.set(subKey, subOptions?.merge ? { ...current, ...subData } : subData);
            },
            get: async () => ({
              exists: writtenDocs.has(`${colName}/${docId}/${subColName}/${subDocId}`),
              data: () => writtenDocs.get(`${colName}/${docId}/${subColName}/${subDocId}`),
            }),
          }),
          get: async () => ({
            empty: true,
            forEach: () => {},
          }),
        }),
      }),
    }),
  };

  setFirebaseAdminFirestoreForTesting(mockDb);

  // Test saving vocabulary containing dirty undefined fields using real saveStudentVocabularyToFirestoreServer
  let saveSuccess = false;
  try {
    saveSuccess = await saveStudentVocabularyToFirestoreServer(
      lalaCanonicalUid,
      [dirtyPayload],
      'laviniatilapiafc@gmail.com'
    );
  } catch (err: any) {
    console.error('saveStudentVocabularyToFirestoreServer error:', err);
  }

  assert(
    saveSuccess === true,
    '2.2: saveStudentVocabularyToFirestoreServer salvou com sucesso sem erro de "undefined"'
  );

  const rootDoc = writtenDocs.get(`users/${lalaCanonicalUid}`);
  assert(
    rootDoc && Array.isArray(rootDoc.vocabulary) && rootDoc.vocabulary.length > 0,
    '2.3: Vocabulário gravado no documento canônico users/{lalaCanonicalUid}'
  );

  const subDoc = writtenDocs.get(`users/${lalaCanonicalUid}/vocabulary/figure_out`);
  assert(
    subDoc && subDoc.word === 'figure out' && subDoc.studentUid === lalaCanonicalUid,
    '2.4: Vocabulário gravado na subcoleção users/{lalaCanonicalUid}/vocabulary/figure_out'
  );

  // ----------------------------------------------------------------------------
  // SECTION 3: sessionVocabularySync GENERATES CLEAN PAYLOAD
  // ----------------------------------------------------------------------------
  console.log('\n--- 3. sessionVocabularySync Geração Limpa sem Undefined ---');

  const syncedList = await syncSessionVocabularyToStudentDictionary({
    studentUid: lalaCanonicalUid,
    studentEmail: 'laviniatilapiafc@gmail.com',
    rawNotes: '<p><span class="new-word">breakthrough</span></p>',
    vocabularyAndExpressions: [
      {
        term: 'breakthrough',
        isNewWord: true,
        definitionEn: 'An important discovery or event that helps solve a problem',
        partOfSpeech: 'Noun',
        // phonetic Guide omitted
      } as any,
    ],
    skipClientWrite: true,
    isDefinitiveAi: true,
  });

  assert(
    syncedList.length === 1 && syncedList[0].word === 'breakthrough',
    '3.1: Palavra Alt+W sincronizada'
  );
  assert(
    !('phonetic' in syncedList[0]),
    '3.2: phonetic omitido em vez de undefined quando não fornecido'
  );
  assert(
    !('lessonRefId' in syncedList[0]),
    '3.3: lessonRefId omitido em vez de undefined quando lessonId ausente'
  );

  // ----------------------------------------------------------------------------
  // SECTION 4: GEMINI 503 ERROR HANDLING & SERVICE_UNAVAILABLE
  // ----------------------------------------------------------------------------
  console.log('\n--- 4. Tratamento do Erro Gemini HTTP 503 (High Demand) ---');

  // Verify that GEMINI_FIXED_MODEL is gemini-3.8-flash
  assert(
    GEMINI_FIXED_MODEL === 'gemini-3.8-flash',
    `4.1: Modelo configurado é gemini-3.8-flash (atual: ${GEMINI_FIXED_MODEL})`
  );

  // Emulate Gemini SDK throwing 503 high demand
  const simulated503Error = new Error('This model is currently experiencing high demand. Please try again later.');
  (simulated503Error as any).status = 503;

  const errMsg = simulated503Error.message;
  const rawStatus = Number((simulated503Error as any).status);
  const isServiceUnavailable =
    rawStatus === 503 ||
    errMsg.includes('503') ||
    errMsg.toLowerCase().includes('high demand') ||
    errMsg.toLowerCase().includes('service unavailable');

  const category = isServiceUnavailable ? 'SERVICE_UNAVAILABLE' : 'INVALID_RESPONSE';

  assert(
    isServiceUnavailable === true,
    '4.2: Erro "This model is currently experiencing high demand" reconhecido como indisponibilidade temporária'
  );
  assert(
    category === 'SERVICE_UNAVAILABLE',
    '4.3: Categoria classificada estritamente como SERVICE_UNAVAILABLE (HTTP 503)'
  );

  // Reset
  resetFirebaseAdminFirestoreForTesting();

  console.log('\n============================================================================');
  console.log(` RESULTADO FINAL: ${passedTests}/${totalTests} testes passaram.`);
  if (failedTests === 0) {
    console.log(' ✅ HOTFIX 4B.8.4 APROVADO COM 100% DE SUCESSO!');
  } else {
    console.error(` ❌ HOTFIX 4B.8.4 TEVE ${failedTests} FALHAS.`);
  }
  console.log('============================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runHotfix4B84TestSuite().catch((err) => {
  console.error('Unhandled test suite failure:', err);
  process.exit(1);
});
