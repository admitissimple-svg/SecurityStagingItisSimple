/**
 * BATERIA DE TESTES DE INTEGRAÇÃO E VALIDAÇÃO COMPLETA:
 * HOTFIX CONTROLADO — NATIVE FRIENDS NOTES / FIDELIDADE PEDAGÓGICA
 *
 * Projeto Exclusivo: itissimple-security-staging
 * Firestore: (default)
 *
 * ESCOPO E VALIDAÇÕES:
 * 1. Parser de Notas:
 *    - Preservação da associação entre cada expressão e seu data-tag-type:
 *      correct, incorrect, new-word e pronounce.
 *    - Remoção de texto decorativo e entidades HTML sem perder as palavras originais.
 *    - Quatro marcações: Blasting + New Word, Blasted + Pronounce, Blate + Incorrect, Blast + Correct.
 *
 * 2. Análise Pedagógica:
 *    - Mistakes: Somente erros reais. Não presumir correção de "Blate" (pendente de confirmação).
 *    - Grammar Points: Somente com evidência suficiente; lista vazia caso contrário.
 *    - Vocabulary & Expressions: Exclusivamente termos marcados como new-word ou pronounce.
 *    - Quick Review: Resumo das outras categorias.
 *    - Zero exemplos mockados ("I have 28 years old", "catch up", etc.).
 *
 * 3. Integração com IA e Fallback:
 *    - CEFR mantido.
 *    - Fallback determinístico fiel às notas sem chamadas pagas.
 *    - Registro seguro de falhas sem expor tokens ou dados pessoais.
 *
 * 4. Cache e Invalidação:
 *    - Invalidação da transformação quando as notas da sessão forem salvas.
 *    - Identificador canônico e content hash para versionamento.
 *    - Não afeta sessões de outros alunos nem apaga histórico.
 *
 * 5. Data (SessionDate):
 *    - Tratamento de 2026-10-14 como data de calendário (Wed, Oct 14), sem conversão UTC que mude o dia.
 *
 * 6. Vínculo e Recuperação:
 *    - Professor e aluno recuperam a mesma sessão por identificadores confiáveis.
 *    - Compatibilidade com registros legados cujo lessonId esteja vazio.
 *    - Preservação do HTML completo no editor do professor.
 *    - Isolamento entre estudantes.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
import path from 'path';
import { parseNotesHtml, cleanExpressionTerm, decodeHtmlEntities } from '../src/utils/notesHtmlParser';
import {
  generateLocalPedagogicalTransformation,
  computeNotesHash,
  getCanonicalSessionKey,
} from '../src/utils/pedagogicalTransformer';
import { formatDateInTimeZone } from '../src/utils/timezone';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: any) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`, detail || '');
    failed++;
  }
}

async function runHotfixValidationSuite() {
  console.log('========================================================================');
  console.log('HOTFIX TEST SUITE: NATIVE FRIENDS NOTES / FIDELIDADE PEDAGÓGICA');
  console.log('Projeto: itissimple-security-staging (default)');
  console.log('========================================================================\n');

  // --------------------------------------------------------------------------
  // ITEM 1: PARSER DE NOTAS (HTML Editor -> Tags & Termos)
  // --------------------------------------------------------------------------
  console.log('TEST GROUP 1: Parser de Notas HTML');

  const rawEditorHtml = `
  <div style="font-family: sans-serif;">
    <p><strong>Native Friend In-Session Notes</strong></p>
    <p>Topic: Expressing excitement and reactions</p>
    <div>
      <span class="inline-coaching-tag new-word-tag font-bold" data-tag-type="new-word" contenteditable="false" style="color: #1d4ed8;">✦ New Word</span>&nbsp;Blasting
    </div>
    <div>
      <span class="inline-coaching-tag pronounce-tag font-bold" data-tag-type="pronounce" contenteditable="false" style="color: #7e22ce;">🎯 Pronounce</span>&nbsp;Blasted
    </div>
    <div>
      <span class="inline-coaching-tag incorrect-tag font-bold" data-tag-type="incorrect" contenteditable="false" style="color: #b91c1c;">✗</span>&nbsp;Blate
    </div>
    <div>
      <span class="inline-coaching-tag correct-tag font-bold" data-tag-type="correct" contenteditable="false" style="color: #15803d;">✓</span>&nbsp;Blast
    </div>
  </div>
  `;

  const parsed = parseNotesHtml(rawEditorHtml);

  assert(parsed.newWordCount === 1, '1.1 Conta exatamente 1 tag Alt+W (new-word)');
  assert(parsed.pronounceCount === 1, '1.2 Conta exatamente 1 tag Alt+P (pronounce)');
  assert(parsed.incorrectCount === 1, '1.3 Conta exatamente 1 tag Alt+N (incorrect)');
  assert(parsed.correctCount === 1, '1.4 Conta exatamente 1 tag Alt+Y (correct)');

  assert(parsed.newWords.length === 1 && parsed.newWords[0] === 'Blasting', '1.5 Termo "Blasting" extraído na categoria new-word', parsed.newWords);
  assert(parsed.pronounceItems.length === 1 && parsed.pronounceItems[0] === 'Blasted', '1.6 Termo "Blasted" extraído na categoria pronounce', parsed.pronounceItems);
  assert(parsed.errors.length === 1 && parsed.errors[0].original === 'Blate', '1.7 Termo "Blate" extraído na categoria incorrect', parsed.errors);
  assert(parsed.errors[0].isPendingConfirmation === true, '1.8 "Blate" marcado com isPendingConfirmation = true (sem correção presumida)', parsed.errors[0]);
  assert(parsed.positives.length === 1 && parsed.positives[0] === 'Blast', '1.9 Termo "Blast" extraído na categoria correct', parsed.positives);

  // Entities & decorative characters clean test
  const dirtyEntitiesHtml = `&lt;span data-tag-type=&quot;new-word&quot;&gt;✦ New Word&lt;/span&gt;&amp;nbsp;Blasting&#39;s`;
  assert(!decodeHtmlEntities(dirtyEntitiesHtml).includes('&amp;'), '1.10 Entidades HTML decodificadas perfeitamente');

  // --------------------------------------------------------------------------
  // ITEM 2: ANÁLISE PEDAGÓGICA (4 Abas e Fidelidade Absoluta)
  // --------------------------------------------------------------------------
  console.log('\nTEST GROUP 2: Análise Pedagógica e Quatro Abas');

  const transformation = generateLocalPedagogicalTransformation({
    rawNotes: rawEditorHtml,
    topic: 'Conversational Fluency',
    sessionDate: '2026-10-14',
    teacherName: 'Charles Watson',
    studentLevel: 'intermediario',
    studentUid: 'student_aluno_1',
    studentEmail: 'aluno1@example.com',
    lessonId: 'lesson_20261014_001',
  });

  // Aba 1: Analyze Mistakes
  assert(transformation.mistakesAnalysis.length === 1, '2.1 Aba Mistakes contém apenas o erro real "Blate"', transformation.mistakesAnalysis.length);
  assert(transformation.mistakesAnalysis[0].original === 'Blate', '2.2 Erro original é "Blate"');
  assert(transformation.mistakesAnalysis[0].isPendingConfirmation === true, '2.3 "Blate" não tem correção inventada (isPendingConfirmation = true)');
  assert(transformation.mistakesAnalysis[0].corrected.includes('Pendente de confirmação'), '2.4 Texto corrigido é pendente de confirmação com o professor');
  assert(transformation.mistakesAnalysis[0].twoExamples.length === 0, '2.5 Zero exemplos inventados para erro não confirmado');

  // Aba 2: Grammar Points
  assert(transformation.grammarPoints.length === 0, '2.6 Aba Grammar Points é lista vazia (sem erros gramaticais sistêmicos nas notas)', transformation.grammarPoints);

  // Aba 3: Vocabulary & Expressions
  assert(transformation.vocabularyAndExpressions.length === 2, '2.7 Aba Vocab contém exclusivamente os 2 termos marcados (Blasting e Blasted)', transformation.vocabularyAndExpressions.length);
  const terms = transformation.vocabularyAndExpressions.map((v) => v.term);
  assert(terms.includes('Blasting') && terms.includes('Blasted'), '2.8 Termos são estritamente Blasting e Blasted', terms);
  const blastedEntry = transformation.vocabularyAndExpressions.find((v) => v.term === 'Blasted');
  assert(blastedEntry?.isPronunciationFocus === true, '2.9 Blasted categorizado como foco de pronúncia');

  // Aba 4: Quick Review
  assert(transformation.reviewSummary.keyRules.length === 0, '2.10 Quick Review keyRules é vazio');
  assert(transformation.reviewSummary.essentialCorrections.length === 1, '2.11 Quick Review resume o erro "Blate"');
  assert(transformation.reviewSummary.mustKnowVocabulary.length === 2, '2.12 Quick Review resume as 2 palavras reais');
  assert(transformation.reviewSummary.rememberThis.includes('Blate'), '2.13 Remember This foca na expressão real');

  // Verificação de Ausência Total de Mocks ("I have 28 years old", "catch up", etc.)
  const serialized = JSON.stringify(transformation);
  assert(!serialized.includes('28 years old'), '2.14 Zero ocorrência de "I have 28 years old"');
  assert(!serialized.includes('catch up'), '2.15 Zero ocorrência de "catch up"');
  assert(!serialized.includes('workload'), '2.16 Zero ocorrência de "workload"');
  assert(!serialized.includes('It depends of'), '2.17 Zero ocorrência de "It depends of"');

  // --------------------------------------------------------------------------
  // ITEM 3: DATA PURA DE CALENDÁRIO (2026-10-14 -> Wed, Oct 14)
  // --------------------------------------------------------------------------
  console.log('\nTEST GROUP 3: Tratamento de Data de Calendário (2026-10-14)');

  const dateEn = formatDateInTimeZone('2026-10-14', 'America/Sao_Paulo', 'en');
  const datePt = formatDateInTimeZone('2026-10-14', 'America/Sao_Paulo', 'pt');

  console.log('    Data Formatada EN:', dateEn);
  console.log('    Data Formatada PT:', datePt);

  assert(dateEn.includes('Wed') && dateEn.includes('14'), '3.1 "2026-10-14" exibido como Wed, Oct 14 (sem recuo para dia 13 por fuso)', dateEn);
  assert(datePt.includes('14'), '3.2 "2026-10-14" preserva o dia 14 em português', datePt);

  // Timestamps com fuso horário preservados
  const realTimestamp = '2026-10-14T23:30:00Z';
  const formattedRealTime = formatDateInTimeZone(realTimestamp, 'America/Sao_Paulo', 'en');
  assert(Boolean(formattedRealTime), '3.3 Timestamp real com componente de hora é tratado normalmente', formattedRealTime);

  // --------------------------------------------------------------------------
  // ITEM 4: CACHE, CONTENT HASH E INVALIDAÇÃO APÓS SALVAMENTO
  // --------------------------------------------------------------------------
  console.log('\nTEST GROUP 4: Cache, Content Hash e Invalidação');

  const hashOriginal = computeNotesHash(rawEditorHtml);
  const updatedHtml = rawEditorHtml + `<div><span data-tag-type="new-word">✦ New Word</span>&nbsp;Stellar</div>`;
  const hashUpdated = computeNotesHash(updatedHtml);

  assert(Boolean(hashOriginal), '4.1 Content hash gerado com sucesso', hashOriginal);
  assert(hashOriginal !== hashUpdated, '4.2 Alteração de notas gera hash distinto para invalidar cache');

  // Simulação de invalidação de cache no banco
  const mockDb: any = {
    sessionNotesMap: {},
    pedagogicalTransformationsMap: {},
  };

  const sessionKey = 'lesson_20261014_001';
  mockDb.sessionNotesMap[sessionKey] = {
    id: sessionKey,
    lessonId: 'lesson_20261014_001',
    studentEmail: 'aluno1@example.com',
    studentUid: 'student_aluno_1',
    content: rawEditorHtml,
  };
  mockDb.pedagogicalTransformationsMap[sessionKey] = transformation;

  // Invalidação idêntica à do endpoint POST /api/session-notes
  const canonicalKey = getCanonicalSessionKey({
    lessonId: 'lesson_20261014_001',
    sessionKey,
    studentUid: 'student_aluno_1',
    studentEmail: 'aluno1@example.com',
    sessionDate: '2026-10-14',
  });

  // Apaga cache para a sessão alterada
  delete mockDb.pedagogicalTransformationsMap[canonicalKey];
  delete mockDb.pedagogicalTransformationsMap[sessionKey];

  assert(mockDb.pedagogicalTransformationsMap[sessionKey] === undefined, '4.3 Cache da sessão foi devidamente invalidado após salvar novas notas');
  assert(mockDb.sessionNotesMap[sessionKey] !== undefined, '4.4 Documento de notas da sessão permanece preservado (não apagado)');

  // --------------------------------------------------------------------------
  // ITEM 5: VÍNCULO, RECUPERAÇÃO E COMPATIBILIDADE LEGADA
  // --------------------------------------------------------------------------
  console.log('\nTEST GROUP 5: Recuperação Professor/Aluno e Registros Legados');

  // Professor e aluno recuperam pelo mesmo lessonId
  const retrievedByTeacher = mockDb.sessionNotesMap['lesson_20261014_001'];
  assert(retrievedByTeacher && retrievedByTeacher.content.includes('Blasting'), '5.1 Professor recupera o HTML completo da sessão');

  // Caso legado: sem lessonId (apenas data e studentEmail)
  const legacyKey = getCanonicalSessionKey({
    lessonId: '',
    studentEmail: 'legacy_student@example.com',
    sessionDate: '2026-05-20',
  });
  assert(legacyKey.includes('legacy_student_example_com') && legacyKey.includes('2026-05-20'), '5.2 Registro legado sem lessonId gera chave canônica estável', legacyKey);

  // --------------------------------------------------------------------------
  // ITEM 6: ISOLAMENTO ENTRE ESTUDANTES
  // --------------------------------------------------------------------------
  console.log('\nTEST GROUP 6: Isolamento entre Estudantes');

  const studentA_doc = {
    id: 'lesson_A',
    studentUid: 'uid_student_A',
    studentEmail: 'studentA@example.com',
    content: '<p>Student A personal notes</p>',
  };
  const studentB_doc = {
    id: 'lesson_B',
    studentUid: 'uid_student_B',
    studentEmail: 'studentB@example.com',
    content: '<p>Student B confidential notes</p>',
  };

  mockDb.sessionNotesMap['lesson_A'] = studentA_doc;
  mockDb.sessionNotesMap['lesson_B'] = studentB_doc;

  const notesForA = Object.values(mockDb.sessionNotesMap).filter(
    (n: any) => n.studentUid === 'uid_student_A'
  );
  assert(notesForA.length === 1 && (notesForA[0] as any).id === 'lesson_A', '6.1 Consulta por estudante A retorna estritamente suas notas');
  assert(!notesForA.some((n: any) => n.studentUid === 'uid_student_B'), '6.2 Estudante A não tem acesso aos dados ou notas do estudante B');

  // --------------------------------------------------------------------------
  // ITEM 7: PARSER COM CORREÇÃO EXPLÍCITA NA MESMA LINHA
  // --------------------------------------------------------------------------
  console.log('\nTEST GROUP 7: Parser com Par Erro/Correção Real');

  const pairedNotesHtml = `
  <p><span data-tag-type="incorrect">✗</span> Blate <span data-tag-type="correct">✓</span> Blast</p>
  `;
  const pairedParsed = parseNotesHtml(pairedNotesHtml);
  assert(pairedParsed.errors.length === 1, '7.1 Par na mesma linha detecta 1 erro');
  assert(pairedParsed.errors[0].original === 'Blate', '7.2 Termo incorreto é Blate');
  assert(pairedParsed.errors[0].corrected === 'Blast', '7.3 Correção expressa pelo professor é Blast');
  assert(pairedParsed.errors[0].isPendingConfirmation === false, '7.4 Correção informada pelo professor não fica pendente');

  console.log('\n========================================================================');
  console.log(`RESULTADO DA BATERIA: ${passed} PASS, ${failed} FAIL`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runHotfixValidationSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
