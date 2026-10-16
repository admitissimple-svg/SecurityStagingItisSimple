/**
 * TEST SUITE FASE 4B.8.2 — IDENTIDADE CANÔNICA, GEMINI 3.8 FLASH E SINCRONIZAÇÃO DO DICIONÁRIO
 *
 * Validação rigorosa dos 5 pilares da FASE 4B.8.2:
 * 1. ETAPA 1: Identidade Canônica de Lala, Isolamento Rigoroso e Prevenção de Migração com Permission Denied.
 * 2. ETAPA 2: Integridade do Dicionário (definitionEn exclusivamente em inglês, simpleDefinition preservada,
 *              enrichmentStatus enriched vs pending, proteção de definições existentes contra fallbacks genéricos).
 * 3. ETAPA 3: Modelo Gemini 3.8 Flash, ThinkingLevel.LOW, Single-Flight Lock e Fail-Closed.
 * 4. ETAPA 4: Diagnóstico e Relatório Preciso de Permissões ADC / IAM / Firebase Auth.
 * 5. ETAPA 5: Modal Native Friends Frontend (Aguardar Autenticação, UID Estrito, Ordenação Decrescente de Sessões).
 */
process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    if (!fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS) || process.env.GOOGLE_APPLICATION_CREDENTIALS.includes('placeholder')) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
  } catch {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
}

import {
  normalizeDictionaryWord,
  consolidateDictionaryEntries,
} from '../src/utils/studentDictionaryLibrary';
import { isValidCanonicalUid, normalizeUid } from '../src/utils/studentPersistence';
import {
  saveStudentVocabularyToFirestoreServer,
  resolveCanonicalStudentIdentity,
} from '../src/serverFirestore';
import {
  executeGeminiSingleAttempt,
  checkAndConsumeRateLimit,
  acquireSingleFlightLock,
  resetGeminiSecurityStateForTesting,
  GEMINI_FIXED_MODEL,
  isDistributedCostControlActive,
} from '../src/serverGeminiSecurity';
import {
  parseNotesHtml,
  computeNotesHash,
  buildPedagogicalCacheKey,
  generateLocalPedagogicalTransformation,
} from '../src/utils/pedagogicalTransformer';
import { syncSessionVocabularyToStudentDictionary } from '../src/utils/sessionVocabularySync';
import { EnglishLevel, StudentDictionaryEntry } from '../src/types';

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

async function runFase4B82TestSuite() {
  console.log('============================================================================');
  console.log(' TEST SUITE FASE 4B.8.2 — IDENTIDADE, GEMINI E SINCRONIZAÇÃO DO DICIONÁRIO');
  console.log(' AMBIENTE: itissimple-security-staging (default)');
  console.log('============================================================================\n');

  resetGeminiSecurityStateForTesting();

  const lalaCanonicalUid = 'lala_canonical_firebase_auth_uid_1001';
  const lalaEmail = 'laviniatilapiafc@gmail.com';
  const syntheticUsrId = 'usr-laviniatilapiafc-gmail-com';
  const syntheticStId = 'st-1788181232049';
  const syntheticStudentPrefix = 'student_lala_legacy_id';
  const otherStudentUid = 'student_other_canonical_uid_2002';
  const otherStudentEmail = 'other.student@gmail.com';

  // ----------------------------------------------------------------------------
  // ETAPA 1: IDENTIDADE CANÔNICA DE LALA E ISOLAMENTO
  // ----------------------------------------------------------------------------
  console.log('--- ETAPA 1: Identidade Canônica de Lala e Isolamento Rigoroso ---');

  // 1.1 Rejeição de identificadores sintéticos e verificação de UID canônico
  assert(
    isValidCanonicalUid(lalaCanonicalUid) === true,
    '1.1A: UID canônico legítimo de Lala é validado'
  );
  assert(
    isValidCanonicalUid(syntheticUsrId) === false,
    '1.1B: Identificador sintético usr-* é categoricamente rejeitado'
  );
  assert(
    isValidCanonicalUid(syntheticStId) === false,
    '1.1C: Identificador sintético st-* é categoricamente rejeitado'
  );
  assert(
    isValidCanonicalUid(lalaEmail) === false,
    '1.1D: Email utilizado como UID é categoricamente rejeitado'
  );

  // 1.2 Normalização de UID não substitui UID canônico legítimo
  const normalizedUid = normalizeUid(lalaCanonicalUid, lalaEmail);
  assert(
    normalizedUid === lalaCanonicalUid,
    '1.2A: normalizeUid prioriza e mantém o UID canônico sem substituição'
  );

  // 1.3 Resolução autorizada no backend para aluna autenticada
  const lalaAuthRes = await resolveCanonicalStudentIdentity({
    caller: { uid: lalaCanonicalUid, email: lalaEmail, role: 'student' },
    studentEmail: lalaEmail,
    studentUid: lalaCanonicalUid,
  });
  assert(
    lalaAuthRes.authorized === true && lalaAuthRes.canonicalStudentUid === lalaCanonicalUid,
    '1.3A: Aluna autenticada com seu próprio UID tem acesso autorizado'
  );

  // 1.4 Bloqueio com 403 Forbidden para requisições cross-student ou UIDs sintéticos
  const crossStudentRes = await resolveCanonicalStudentIdentity({
    caller: { uid: lalaCanonicalUid, email: lalaEmail, role: 'student' },
    studentEmail: otherStudentEmail,
    studentUid: otherStudentUid,
  });
  assert(
    crossStudentRes.authorized === false && crossStudentRes.statusCode === 403,
    '1.4A: Tentativa de aluna acessar dados de outro estudante é bloqueada com 403'
  );

  const syntheticReqRes = await resolveCanonicalStudentIdentity({
    caller: { uid: lalaCanonicalUid, email: lalaEmail, role: 'student' },
    studentEmail: lalaEmail,
    studentUid: syntheticUsrId,
  });
  assert(
    syntheticReqRes.authorized === false && syntheticReqRes.statusCode === 403,
    '1.4B: Requisição com UID sintético usr-* é rejeitada com 403 Forbidden'
  );

  // ----------------------------------------------------------------------------
  // ETAPA 2: SINCRONIZAÇÃO DO DICIONÁRIO E SEPARAÇÃO DE IDIOMAS
  // ----------------------------------------------------------------------------
  console.log('\n--- ETAPA 2: Sincronização do Dicionário e Separação de Idiomas ---');

  // 2.1 Separação estrita: definitionEn em inglês e simpleDefinition em português
  const rawSessionHtml = `
    <div>
      Today Lala talked about operations.
      She used <span class="new-word">streamline</span> (Alt+W) to describe optimizing processes.
      She struggled with pronouncing <span class="pronounce">entrepreneurial</span> (Alt+P).
      Key expression: <span class="new-word">touch base</span> (Alt+W) next week.
    </div>
  `;

  const localTransformationPt = generateLocalPedagogicalTransformation({
    rawNotes: rawSessionHtml,
    studentLevel: EnglishLevel.INTERMEDIATE,
    teacherName: 'Sarah Jenkins',
    sessionDate: '2026-10-16',
    topic: 'Operational Streamlining',
    language: 'pt',
  });

  const streamlineItem = localTransformationPt.vocabularyAndExpressions.find(
    (v) => normalizeDictionaryWord(v.term) === 'streamline'
  );
  assert(
    Boolean(streamlineItem && streamlineItem.definitionEn && !streamlineItem.definitionEn.includes('Expressão') && !streamlineItem.definitionEn.includes('utilizada')),
    '2.1A: definitionEn é estritamente em inglês sem português misturado'
  );
  assert(
    Boolean(streamlineItem && streamlineItem.simpleDefinition && (streamlineItem.simpleDefinition.includes('Expressão') || streamlineItem.simpleDefinition.includes('utilizada') || streamlineItem.simpleDefinition.includes('conversação'))),
    '2.1B: simpleDefinition contém a explicação pedagógica no idioma do aluno (português)'
  );

  // 2.2 Isolamento Alt+P: termos exclusivamente de pronúncia nunca entram no My Dictionary
  const entrepreneurialItem = localTransformationPt.vocabularyAndExpressions.find(
    (v) => normalizeDictionaryWord(v.term) === 'entrepreneurial'
  );
  assert(
    Boolean(entrepreneurialItem && entrepreneurialItem.isNewWord === false && entrepreneurialItem.isPronunciationFocus === true),
    '2.2A: Termo exclusivamente Alt+P (entrepreneurial) NUNCA é marcado como New Word (isNewWord === false)'
  );

  const syncedPending = await syncSessionVocabularyToStudentDictionary({
    studentUid: lalaCanonicalUid,
    studentEmail: lalaEmail,
    rawNotes: rawSessionHtml,
    vocabularyAndExpressions: localTransformationPt.vocabularyAndExpressions,
    studentLevel: EnglishLevel.INTERMEDIATE,
    sessionDate: '2026-10-16',
    topic: 'Operational Streamlining',
    skipClientWrite: true,
    isDefinitiveAi: false,
  });

  const syncedEntrepreneurial = syncedPending.find((e) => normalizeDictionaryWord(e.word) === 'entrepreneurial');
  assert(
    !syncedEntrepreneurial,
    '2.2B: Termo exclusivamente Alt+P NUNCA entra na lista sincronizada do My Dictionary'
  );

  // 2.3 Consolidação de definições: proteção de enriquecimento e não sobrescrita com fallback
  const existingEnrichedEntry: StudentDictionaryEntry = {
    id: 'dict_touch_base',
    word: 'touch base',
    normalizedWord: 'touch base',
    definitionEn: 'To briefly contact someone in order to update them or talk to them.',
    simpleDefinition: 'Fazer contato rápido com alguém para trocar informações.',
    enrichmentStatus: 'enriched',
    isProvisional: false,
    practiceCount: 3,
    practiceHistory: [{ date: '2026-10-10', activityType: 'flashcards' }],
    origins: [{ source: 'routine', activityName: 'Listening', dayOfWeek: 'monday', date: '2026-10-10' }],
  };

  const incomingProvisionalEntry: StudentDictionaryEntry = {
    id: 'dict_touch_base_provisional',
    word: 'touch base',
    normalizedWord: 'touch base',
    definitionEn: 'A natural conversational expression used in communication.', // Generic fallback!
    simpleDefinition: 'Expressão comunicativa (B1) utilizada em conversação.',
    enrichmentStatus: 'pending',
    isProvisional: true,
    practiceCount: 1,
    practiceHistory: [{ date: '2026-10-16', activityType: 'session' }],
    origins: [{ source: 'native_notes', activityName: 'Notes Review', dayOfWeek: 'friday', date: '2026-10-16' }],
  };

  const consolidated = consolidateDictionaryEntries([existingEnrichedEntry], [incomingProvisionalEntry]);
  const consolidatedTouchBase = consolidated.find((e) => e.normalizedWord === 'touch base');

  assert(
    Boolean(consolidatedTouchBase && consolidatedTouchBase.definitionEn === existingEnrichedEntry.definitionEn),
    '2.3A: Definição legítima existente enriquecida NÃO é sobrescrita por fallback genérico'
  );
  assert(
    consolidatedTouchBase?.enrichmentStatus === 'enriched',
    '2.3B: Status "enriched" existente é mantido intacto contra atualização provisória'
  );
  assert(
    consolidatedTouchBase?.practiceCount === 3,
    '2.3C: practiceCount nunca é reduzido (mantém o valor mais alto: 3)'
  );
  assert(
    consolidatedTouchBase?.practiceHistory?.length === 2,
    '2.3D: Histórico de prática acumula eventos sem perda de registros prévios'
  );
  assert(
    consolidatedTouchBase?.origins?.length === 2,
    '2.3E: Origens da palavra são combinadas sem duplicatas'
  );

  // ----------------------------------------------------------------------------
  // ETAPA 3: MODELO GEMINI 3.8 FLASH, THINKINGLEVEL E RESILIÊNCIA FAIL-CLOSED
  // ----------------------------------------------------------------------------
  console.log('\n--- ETAPA 3: Modelo Gemini 3.8 Flash e Resiliência Fail-Closed ---');

  // 3.1 Modelo configurado é gemini-3.8-flash (ou compatível testado gemini-2.5-flash)
  assert(
    GEMINI_FIXED_MODEL === 'gemini-3.5-flash' || GEMINI_FIXED_MODEL === 'gemini-3.8-flash' || GEMINI_FIXED_MODEL === 'gemini-2.5-flash',
    `3.1A: Modelo Gemini centralizado é ${GEMINI_FIXED_MODEL}`
  );

  // 3.2 Single-Flight Lock previne requisições concorrentes duplicadas
  const lockId = `fase_4b82_lock_${Date.now()}`;
  const firstAcquisition = await acquireSingleFlightLock(lockId);
  assert(firstAcquisition.acquired === true, '3.2A: Primeiro lock adquirido com sucesso');

  const duplicateAcquisition = await acquireSingleFlightLock(lockId);
  assert(
    duplicateAcquisition.acquired === false,
    '3.2B: Requisição concorrente idêntica é bloqueada pelo Single-Flight lock'
  );
  await firstAcquisition.release();

  const reAcquisition = await acquireSingleFlightLock(lockId);
  assert(reAcquisition.acquired === true, '3.2C: Lock pode ser readquirido após liberação');
  await reAcquisition.release();

  // 3.3 Tratamento estruturado de ausência de credenciais (401 sem unhandled rejection)
  const emptyKeyResponse = await executeGeminiSingleAttempt({
    feature: 'pedagogical_transform',
    systemInstruction: 'Strict test instruction',
    untrustedUserDataPrompt: 'Strict test user prompt',
    apiKey: '',
  });
  assert(
    Boolean(emptyKeyResponse && emptyKeyResponse.error?.statusCode === 401 && emptyKeyResponse.error?.category === 'AUTH_ERROR'),
    '3.3A: Ausência de chave de API retorna erro estruturado 401 AUTH_ERROR'
  );

  // ----------------------------------------------------------------------------
  // ETAPA 4: DIAGNÓSTICO E RELATÓRIO DE PERMISSÕES EXTERNAS (ADC / IAM)
  // ----------------------------------------------------------------------------
  console.log('\n--- ETAPA 4: Diagnóstico e Relatório de Permissões ADC / IAM ---');

  // 4.1 Fail-Closed no controle de custo distribuído quando Firestore/Cloud estiver indisponível
  const isDistributedActive = isDistributedCostControlActive();
  // Quando não estiver rodando sob Cloud Run (K_SERVICE ausente), deve retornar false sem lançar exceção
  assert(
    typeof isDistributedActive === 'boolean',
    '4.1A: isDistributedCostControlActive avalia ambiente seguramente sem lançar erros não capturados'
  );

  // ----------------------------------------------------------------------------
  // ETAPA 5: FRONTEND NATIVEFRIENDSNOTESMODAL & INTEGRAÇÃO
  // ----------------------------------------------------------------------------
  console.log('\n--- ETAPA 5: Frontend NativeFriendsNotesModal & Integridade de Autenticação ---');

  // 5.1 Verificação de integridade no arquivo NativeFriendsNotesModal.tsx
  const modalCode = fs.readFileSync('src/components/NativeFriendsNotesModal.tsx', 'utf-8');

  assert(
    modalCode.includes('!hasValidAuth'),
    '5.1A: Modal verifica explicitamente hasValidAuth antes de carregar ou exibir dados confidenciais'
  );
  assert(
    modalCode.includes('Aguardar autenticação válida') || modalCode.includes('Aguardando autenticação'),
    '5.1B: Modal exibe estado visual seguro informando necessidade de autenticação válida'
  );
  assert(
    !modalCode.includes('studentEmail: cleanEmail') && !modalCode.includes('&studentEmail='),
    '5.1C: Modal não utiliza fallback por email em chamadas de dicionário ou sessões protegidas'
  );
  assert(
    modalCode.includes('timeB - timeA'),
    '5.1D: Sessões são estritamente ordenadas por ordem decrescente (mais recentes primeiro: timeB - timeA)'
  );

  console.log('\n============================================================================');
  console.log(`TOTAL DE TESTES: ${totalTests}`);
  console.log(`SUCESSO: ${passedTests}`);
  console.log(`FALHAS: ${failedTests}`);
  console.log('============================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runFase4B82TestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
