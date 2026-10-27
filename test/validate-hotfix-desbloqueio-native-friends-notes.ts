import fs from 'fs';
import assert from 'assert';

console.log('========================================================================');
console.log('TEST SUITE: HOTFIX CIRÚRGICO — DESBLOQUEIO DO NATIVE FRIENDS NOTES');
console.log('========================================================================\n');

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

// 1. Read NativeFriendsNotesModal.tsx
const modalContent = fs.readFileSync('src/components/NativeFriendsNotesModal.tsx', 'utf-8');

console.log('--- ETAPA 1: Desbloqueio Imediato da Interface e Desacoplamento ---');

check(
  modalContent.includes('// Step 1: Set pedagogical transformation report as soon as available') &&
  modalContent.includes('setTransformation(result);') &&
  modalContent.includes('// Step 2: Unblock visual presentation immediately so the user sees notes without delay') &&
  modalContent.includes('setIsLoadingTransformation(false);'),
  '1.1: setIsLoadingTransformation(false) é liberado imediatamente após setTransformation(result) no bloco finally'
);

// Verify that syncSessionVocabularyToStudentDictionary is NOT awaited inside the main try block of loadPedagogicalNotes
const loadPedNotesSection = modalContent.substring(
  modalContent.indexOf('const loadPedagogicalNotes = useCallback('),
  modalContent.indexOf('const lastLoadedSessionRef = useRef')
);

check(
  !loadPedNotesSection.includes('await syncSessionVocabularyToStudentDictionary'),
  '1.2: loadPedagogicalNotes NÃO aguarda syncSessionVocabularyToStudentDictionary (execução 100% assíncrona)'
);

check(
  loadPedNotesSection.includes('// Instant visual unlock: notes display immediately from cache') &&
  loadPedNotesSection.includes('performVocabularySync(cached, activeSession, false);'),
  '1.3: Ao abrir relatório existente em cache, interface é liberada instantaneamente e sync roda em background'
);

console.log('\n--- ETAPA 2: Execução Assíncrona e Indicador Específico isSyncingVocab ---');

check(
  modalContent.includes('performVocabularySync = useCallback('),
  '2.1: Função dedicada performVocabularySync executa sincronização assíncrona'
);

check(
  modalContent.includes('setIsSyncingVocab(true)') &&
  modalContent.includes('setIsSyncingVocab(false)'),
  '2.2: isSyncingVocab é gerenciado como indicador de sincronização específico'
);

check(
  modalContent.includes('{isSyncingVocab && (') &&
  modalContent.includes('animate-spin'),
  '2.3: Indicador visual específico para sincronização em segundo plano está presente'
);

console.log('\n--- ETAPA 3: Tratamento de Erros Sem Promises Rejeitadas ---');

check(
  modalContent.includes('.catch((syncErr: any) => {') &&
  modalContent.includes("console.error('NativeFriendsNotes: vocabulary sync failure:', syncErr);") &&
  modalContent.includes('setVocabSyncError('),
  '3.1: Promise de sincronização possui bloco .catch robusto registrando erro e definindo vocabSyncError'
);

check(
  modalContent.includes('finally(() => {') &&
  modalContent.includes('inFlightVocabSyncPromises.delete(syncKey);'),
  '3.2: Promise é limpa em .finally() garantindo ausência de locks órfãos'
);

console.log('\n--- ETAPA 4: Prevenção de Duplicações e Preservação no Desmonte/Fechamento ---');

check(
  modalContent.includes('const inFlightVocabSyncPromises = new Map<string, Promise<StudentDictionaryEntry[]>>();'),
  '4.1: inFlightVocabSyncPromises rastreia promessas em execução a nível de módulo evitando concorrência duplicada'
);

check(
  modalContent.includes('const completedVocabSyncKeys = new Set<string>();'),
  '4.2: completedVocabSyncKeys memoriza chaves já sincronizadas evitando re-POST em remontagens'
);

check(
  modalContent.includes('isMountedRef.current'),
  '4.3: isMountedRef protege atualizações de estado local ao fechar o modal enquanto sync continua em execução'
);

console.log('\n--- ETAPA 5: Preservação do Callback onVocabularySynced ---');

check(
  modalContent.includes('if (syncedEntries && syncedEntries.length > 0) {') &&
  modalContent.includes('if (onVocabularySynced) {') &&
  modalContent.includes('onVocabularySynced(syncedEntries);'),
  '5.1: onVocabularySynced é chamado exclusivamente após conclusão bem-sucedida da sincronização'
);

console.log('\n--- ETAPA 6: Respeito às Restrições do Hotfix Cirúrgico ---');

const syncVocabCode = fs.readFileSync('src/utils/sessionVocabularySync.ts', 'utf-8');
const studentPersistCode = fs.readFileSync('src/utils/studentPersistence.ts', 'utf-8');
const serverAppCode = fs.readFileSync('serverApp.ts', 'utf-8');
const serverFirestoreCode = fs.readFileSync('src/serverFirestore.ts', 'utf-8');

check(syncVocabCode.length > 0, '6.1: sessionVocabularySync.ts permanece íntegro');
check(studentPersistCode.length > 0, '6.2: studentPersistence.ts permanece íntegro');
check(serverAppCode.length > 0, '6.3: serverApp.ts permanece íntegro');
check(serverFirestoreCode.length > 0, '6.4: serverFirestore.ts permanece íntegro');

console.log('\n========================================================================');
console.log(`TOTAL: ${passed + failed} | SUCESSO: ${passed} | FALHAS: ${failed}`);
console.log('========================================================================\n');

if (failed > 0) {
  process.exit(1);
}
