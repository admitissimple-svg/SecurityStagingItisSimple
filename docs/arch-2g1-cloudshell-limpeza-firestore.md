# ARCH.2G.1 — Preparação da Limpeza Segura do Firestore `(default)` via Google Cloud Shell

Este documento descreve o procedimento operacional mínimo no **Google Cloud Shell** para auditar, fazer backup íntegro e preparar a limpeza controlada do banco Firestore **`(default)`** do projeto **`itissimple-security-staging`**, utilizando a sessão autenticada do próprio operador (`gcloud`), sem depender de credenciais do sandbox AI Studio, sem conceder IAM ao sandbox, sem alterar `firestore.rules` e sem realizar deploy.

> **Escopo do entregável (ARCH.2G.1):** Preparação e validação offline. Nenhuma exclusão foi executada na nuvem durante esta etapa.

---

## 1. Instruções Mínimas para Execução no Google Cloud Shell

### Pré-requisitos
- Sessão autenticada no Google Cloud Shell com conta de administrador/operador do projeto (`itissimple-security-staging`).
- Permissões usuais do operador no projeto alvo: leitura/escrita no Firestore, visualização do Firebase Authentication (`roles/firebaseauth.viewer`), e inspeção/atualização de Cloud Run caso exista serviço ativo (`--quiesce-cloud-run`).
- Node.js `>= 18` e `gcloud` (nativos no Google Cloud Shell).

### Passo 1 — Conferir o projeto ativo e baixar/posicionar no repositório
```bash
gcloud auth list
gcloud config set project itissimple-security-staging
chmod +x ./scripts/cloudshell-firestore-clean.sh
```

### Passo 2 — Executar o modo `--backup-only` (somente leitura)
```bash
./scripts/cloudshell-firestore-clean.sh --backup-only \
  --project itissimple-security-staging
```
*(Opcional: para gerar também um export gerenciado nativo do Firestore em bucket GCS, acrescente `--gcs-bucket gs://SEU-BUCKET-BACKUP`.)*
*(Opcional: para limpar dados Firestore de contas de QA específicas criadas no Auth, mantendo os usuários no Firebase Auth intactos, acrescente `--clean-test-uids uid1,uid2` ou `--clean-test-emails qa@dominio.com`.)*

O modo `--backup-only`:
1. Identifica e valida o projeto real ativo (`itissimple-security-staging`, bloqueando o projeto legado `itissimple-8663d`) e confirma a existência do banco `(default)`.
2. Verifica serviços ativos que possam escrever no Firestore (`Cloud Run`, `Cloud Functions`, `Cloud Scheduler`).
3. Lista todos os usuários do Firebase Authentication **removendo em memória** qualquer hash de senha, `salt`, tokens de sessão ou segredos (`auth-users-sanitized.json`).
4. Exporta recursivamente todas as coleções e subcoleções do Firestore `(default)` (incluindo subcoleções sob documentos virtuais/ausentes via `showMissing=true`), mascarando campos sensíveis como `token`, `password`, `apiKey`, `secret` (`firestore-default-export.json`).
5. Gera o plano determinístico de limpeza (`cleanup-plan.json`) com `planHash` SHA-256, relatório legível (`inventory-report.md`), manifesto (`backup-manifest.json` com `status: "COMPLETED"`) e checksums (`backup.sha256`), todos com permissão `0600`.

### Passo 3 — Inspecionar o inventário e confirmar antes de habilitar `--execute-clean`
```bash
BACKUP_DIR="$(ls -td "$HOME"/itissimple-arch2g1-backups/itissimple-security-staging-* | head -n1)"
cat "$BACKUP_DIR/inventory-report.md"
jq -r '.planHash' "$BACKUP_DIR/cleanup-plan.json"
```
Verifique manualmente no relatório:
- Contas do Firebase Authentication listadas (100% preservadas).
- Quantidade e lista de documentos em `PRESERVE`, `SANITIZE_FIELDS`, `DELETE_DOC` e `REVIEW`.
- Estado dos serviços Cloud Run / Functions / Scheduler detectados.

### Passo 4 — Executar `--execute-clean` (somente após validar Passo 3)
```bash
PLAN_HASH="$(jq -r '.planHash' "$BACKUP_DIR/cleanup-plan.json")"

./scripts/cloudshell-firestore-clean.sh --execute-clean \
  --backup-dir "$BACKUP_DIR" \
  --confirm-project itissimple-security-staging \
  --confirm-plan-hash "$PLAN_HASH" \
  --quiesce-cloud-run
```
*(Se não houver Cloud Run ativo, mas houver Cloud Scheduler/Functions que você confirmou serem inofensivos, adicione `--acknowledge-no-active-writers`.)*

Na execução:
- O script valida que o manifesto está `COMPLETED`, o `databaseId` é `(default)`, o backup tem menos de 24h (ou `--allow-stale-backup`), os hashes SHA-256 conferem com `backup-manifest.json`, e `--confirm-project` / `--confirm-plan-hash` batem exatamente.
- Solicita confirmação interativa final exigindo digitar exatamente `CONFIRMAR LIMPEZA itissimple-security-staging`.

### Passo 5 — Recuperação em caso de interrupção (`--resume`)
Cada operação concluída é gravada imediatamente no log append-only `execution-journal.jsonl`. Em caso de falha de rede ou desconexão do Cloud Shell:
```bash
./scripts/cloudshell-firestore-clean.sh --execute-clean --resume --quiesce-cloud-run \
  --backup-dir "$BACKUP_DIR" \
  --confirm-project itissimple-security-staging \
  --confirm-plan-hash "$PLAN_HASH"
```
Operações já marcadas como `COMPLETED` no journal são puladas; exclusões já efetivadas antes da queda retornam `404` e são tratadas de forma idempotente em `--resume`.

---

## 2. Proteção Contra Processos Ativos e Concorrência

Para impedir que instâncias ativas regravem caches antigos (por exemplo `serverApp.ts` sincronizando RAM para `app_state/main_data`, `app_state/routines`, `app_state/tutors` ou `app_state/lessons`) durante a janela de limpeza:

1. **Bloqueio de Escritores Ativos (`inspectActiveWriters` + `--quiesce-cloud-run`):**
   - Serviços Cloud Run que não estejam com `DIAGNOSTIC_ONLY=true` bloqueiam `--execute-clean` por padrão.
   - Com `--quiesce-cloud-run`, o script salva a configuração prévia de `DIAGNOSTIC_ONLY` em `cloudrun-quiesce-state.json`, aplica `DIAGNOSTIC_ONLY=true` via `gcloud run services update --update-env-vars=DIAGNOSTIC_ONLY=true` durante a execução e restaura o estado original no bloco `finally` (inclusive ao concluir uma retomada com `--resume`).
   - Presença de Cloud Functions ou Cloud Scheduler `ENABLED` exige confirmação explícita com `--acknowledge-no-active-writers`.
2. **Trava Exclusiva no Firestore (`_maintenance_locks/arch_2g_cleanup`):**
   - Antes da primeira mutação, o script cria o documento `_maintenance_locks/arch_2g_cleanup` atomicamente (TTL de 30 minutos). Outra execução concorrente é bloqueada; apenas o mesmo `executionId` em `--resume` (ou lock expirado) pode retomar.
3. **Precondição Otimista por Documento (`currentDocument.updateTime`):**
   - Toda requisição REST `DELETE` e `PATCH` envia `currentDocument.updateTime` obtido no backup. Se qualquer processo externo alterar um documento entre o backup e a limpeza, o Firestore rejeita com HTTP `400`/`409` e o script aborta imediatamente para preservar a integridade.

---

## 3. Relatório do que Será Preservado, Sanitizado ou Excluído

### A. 100% Preservado (Zero alterações)
| Alvo | Escopo / Regra | Justificativa |
|---|---|---|
| **Firebase Authentication** | Todas as contas, UIDs, e-mails e `customClaims` | O script nunca chama endpoints de alteração/exclusão do Identity Toolkit (`list` apenas com sanitização de credenciais). |
| **`app_state/admin_bootstrap`** | Documento completo | Trava única de bootstrap do administrador (`adm.itissimple@gmail.com`). |
| **`app_state/youtube_playlists`** | Documento completo | Cache estrutural de playlists YouTube do catálogo pedagógico. |
| **`app_state/youtube_auth`** | Documento completo no banco (token redactado no backup) | Configuração OAuth do canal administrativo. |
| **`ptax_rates/*`** | Coleção raiz completa | Cache estrutural BACEN PTAX D-1 usado pelo motor financeiro. |
| **Campos estruturais em `app_state/*`** | `main_data`: `landingContent`, `meetSettings`, `teacherSettings`, `spotifyPlaylists`, `updatedAt`<br>`routines`: `routinesByDay`, `updatedAt` | Conteúdo institucional da vitrine, configurações de aulas/Meet e template padrão de rotinas. |
| **Administradores** | Contas com `customClaims.role === 'admin'`, `customClaims.admin === true`, ou `adm.itissimple@gmail.com` em `users/{uid}` e em `app_state/tutors.teachers` | Protegidos mesmo se passados acidentalmente em `--clean-test-uids` / `--clean-test-emails`. |
| **Usuários legítimos e subcoleções canônicas** | `users/{uid}` (UID canônico >= 20 chars presente no Firebase Auth, não-teste) + subcoleções canônicas (`routines`, `currentRoutine`, `weeklyChecks`, `homework/week-*`, `weeklyHistory`, `vocabulary`, `journal`, `activity_journal`, `session_notes/review_cycle`) | Dados reais dos alunos, tutores e professores ativos. |
| **Coleções relacionais e de perfil ativas** | `tutors/{uid}`, `student_assignments/{uid}`, `teacher_availability/{uid}`, `lessons/*`, `session_notes/*`, `direct_messages/*`, `lesson_insights/*`, `financial_transactions/*` vinculadas a UIDs válidos e não-teste | Vínculos, agendamentos, notas, mensagens, insights e transações financeiras reais. |
| **Coleções/docs desconhecidos sem marcação de teste** | Classificados como `REVIEW` | Política conservadora: nunca excluir automaticamente estruturas não mapeadas. |

### B. Sanitizado In-Place (`PATCH` com `updateMask.fieldPaths`, preservando o documento)
| Documento | Campos Removidos / Ajustados | Justificativa |
|---|---|---|
| **`app_state/main_data`** | Remove caches legados de monólito: `userProfiles`, `authUsers`, `students`, `deletedStudentEmails`, `deletedTutorEmails`, `deletedTutorIds`, `emailLogs`, `transactions`, `studentDictionaryMap`, `sessionNotesMap`, `sessionNotesProgressMap`, `pedagogicalTransformationsMap`, `liveLessons`, `lessons`, `scheduledLessons`, `studentJournalMap`, `weeklyHomework`, `studentHomeworkMap`, `studentRoutinesMap`, `studentCurrentRoutines`, `routinesByDay` (cópia duplicada), `studentWeeklyChecks`, `weeklyNativeTargets`, `studentVideoAssignments`, `studentSpotifyAssignments`, `studentWatchedVideos`, `studentListenedTracks`, `studentAwaitingTopicSelection`, `weeklyStudyDays`, `weeklyStudyDaysTargets`, `tutorsList`, `teachers`, `contractedLessons`. | Elimina resíduos legados do antigo `app_db.json` mantendo `landingContent`, `meetSettings`, `teacherSettings` e `spotifyPlaylists`. |
| **`app_state/routines`** | Remove `studentRoutinesMap`, `studentCurrentRoutines`, `weeklyNativeTargets`, `studentWeeklyChecks`. | Mantém exclusivamente o template estrutural `routinesByDay`. |
| **`app_state/tutors`** | Remove `tutorsList`, `deletedTutorEmails`, `deletedTutorIds` e filtra `teachers` mantendo somente contas `admin` verificadas. | Remove resíduos legados de vitrine preservando registros administrativos canônicos. |
| **`app_state/lessons`** | Remove `liveLessons`, `lessons`, `scheduledLessons`, `weeklyHomework`, `studentHomeworkMap` e poda em `contractedLessons` apenas e-mails inexistentes no Auth ou de teste. | Remove arrays legados preservando saldos válidos de aulas contratadas de usuários reais. |
| **`users/{uid}` (preservados)** | Remove credenciais em texto claro/hash (`password`, `confirmPassword`, `newPassword`, `rawPassword`, `hash`, `salt`) e espelhos legados (`scheduledLessons`, `weeklyChecks`, `sPathChecks`, `weeklyHomework`, `nativeNotesReview`, `lastReminderShownDate`). Remove `vocabulary`, `studentJournal` e `dailyJournalEntries` na raiz **somente se** a subcoleção canônica correspondente já existir. | Elimina resíduos de autenticação local antiga e duplicações já migradas para subcoleções canônicas sem risco de perda de dados. |

### C. Excluído (`DELETE_DOC`, sempre das subcoleções para a raiz)
| Alvo | Critério | Justificativa |
|---|---|---|
| **Coleções descontinuadas / diagnósticas / locks efêmeros** | `live_lessons/*`, `student_homework/*`, `_diagnostic_probes/*`, `gemini_inflight_locks/*`, `gemini_rate_limits/*` | Coleções descontinuadas (substituídas por `lessons` e `users/{uid}/homework`), sondas de diagnóstico e locks transitórios de execução. |
| **Documentos obsoletos em `app_state/*`** | `app_state/assignments`, `app_state/main`, e docs com prefixo de teste (`test-*`, `diag-*`, `probe-*`, `mock-*`, `seed-*`, `*connectivity_check*`) | Monólitos antigos descontinuados e documentos de teste. |
| **Registros de teste / `app_db.json` / não-canônicos / órfãos** | Docs em `users`, `tutors`, `student_assignments`, `teacher_availability`, `lessons`, `session_notes`, `direct_messages`, `lesson_insights`, `financial_transactions` com: ID legado (`usr-*`, `st-*`, `tutor-*`, e-mail), `isTest: true`, `isLocalJsonRecord: true`, `origin: "local_json"`, `source: "app_db.json"`, e-mails de teste (`@example.com`, `@test.com`, etc.), UID marcado em `--clean-test-uids`/`--clean-test-emails`, ou UID ausente no Firebase Auth | Remove integralmente dados de teste, sementes do `app_db.json` e registros órfãos sem conta no Auth. |
| **Subcoleções legadas sob usuários preservados** | `users/{uid}/studentJournal/*`, `users/{uid}/homework/current_week`, `users/{uid}/session_notes/{id != 'review_cycle'}` | Estruturas substituídas por `activity_journal`/`journal`, `homework/week-{cycle}` e coleção raiz `session_notes`. |
