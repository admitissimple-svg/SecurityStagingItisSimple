import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

console.log('========================================================================');
console.log('TEST SUITE: HOTFIX CIRÚRGICO — NATIVE FRIENDS NOTES (REDUNDANT QUERY ELIMINATION)');
console.log('Ambiente: It\'s Simple — Security Staging');
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

console.log('--- ETAPA 1: Eliminação da Consulta Redundante a Student Dictionary ---');

check(
  !modalContent.includes('persistedWordsSet'),
  '1.1: Estado persistedWordsSet foi categoricamente removido'
);

check(
  !modalContent.includes('setPersistedWordsSet'),
  '1.2: Setter setPersistedWordsSet foi categoricamente removido'
);

check(
  !modalContent.includes('loadStudentPersistedDictionary'),
  '1.3: Função de carregamento loadStudentPersistedDictionary foi removida'
);

check(
  !modalContent.includes('/api/student-dictionary'),
  '1.4: Nenhuma requisição a /api/student-dictionary é iniciada pelo modal'
);

check(
  !modalContent.includes("import { normalizeDictionaryWord } from '../utils/studentDictionaryLibrary'"),
  '1.5: Import não utilizado normalizeDictionaryWord foi removido'
);

check(
  !modalContent.includes("import { getAccessToken } from '../utils/auth'"),
  '1.6: Import não utilizado getAccessToken foi removido'
);

console.log('\n--- ETAPA 2: Preservação Integral das Abas e da Navegação ---');

check(
  modalContent.includes("'mistakes'") &&
  modalContent.includes("'grammar'") &&
  modalContent.includes("'vocab'") &&
  modalContent.includes("'summary'"),
  '2.1: Todas as quatro abas (mistakes, grammar, vocab, summary) permanecem definidas'
);

check(
  modalContent.includes('TABS_ORDER') &&
  modalContent.includes('handleNextTab') &&
  modalContent.includes('handlePrevTab'),
  '2.2: Controles de navegação sequencial entre abas permanecem intactos'
);

console.log('\n--- ETAPA 3: Preservação dos Indicadores e Informações Pedagógicas ---');

check(
  modalContent.includes('PedagogicalLessonTransformation') &&
  modalContent.includes('fetchPedagogicalTransformation') &&
  modalContent.includes('resolveCefrLevel') &&
  modalContent.includes('extractNotesMarkings'),
  '3.1: Pipeline de análise e transformação pedagógica permanece preservado'
);

check(
  modalContent.includes('syncSessionVocabularyToStudentDictionary') &&
  modalContent.includes('onVocabularySynced'),
  '3.2: Sincronização pedagógica de vocabulário da sessão e callback onVocabularySynced continuam operando'
);

check(
  modalContent.includes('isSyncingVocab') &&
  modalContent.includes('vocabSyncError'),
  '3.3: Indicadores de feedback e status de sincronização de vocabulário permanecem ativos'
);

console.log('\n--- ETAPA 4: Integridade do My Dictionary ---');

const personalDictModal = fs.readFileSync('src/components/PersonalDictionaryModal.tsx', 'utf-8');
check(
  personalDictModal.includes('/api/student-dictionary'),
  '4.1: My Dictionary (PersonalDictionaryModal) mantém seu acesso ao endpoint legítimo /api/student-dictionary'
);

const serverApp = fs.readFileSync('serverApp.ts', 'utf-8');
check(
  serverApp.includes('/api/student-dictionary'),
  '4.2: Endpoint /api/student-dictionary permanece inalterado no servidor'
);

console.log('\n========================================================================');
console.log(`TOTAL: ${passed + failed} | SUCESSO: ${passed} | FALHAS: ${failed}`);
console.log('========================================================================\n');

if (failed > 0) {
  process.exit(1);
}
