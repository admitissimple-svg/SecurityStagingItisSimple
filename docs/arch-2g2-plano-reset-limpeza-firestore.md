# ARCH.2G.2 — Plano Revisado de Reset Completo de Dados de Teste e Limpeza do Firestore `(default)`

> **Status:** Plano revisado pronto para análise e aprovação. **Nenhuma exclusão foi executada na nuvem**, e **Firebase Auth, `firestore.rules` e infraestrutura não foram alterados**.

Este plano substitui o recorte seletivo do `ARCH.2G.1` por um **reset completo dos dados de teste** no banco Firestore **`(default)`** do projeto **`itissimple-security-staging`**, incluindo **todos os registros de teste associados aos quatro usuários reais cadastrados no Firebase Authentication**, preservando integralmente o Firebase Auth (contas, UIDs, `customClaims`), configurações estruturais essenciais e exigindo **backup integral restaurável nativo em GCS** antes de qualquer mutação.

---

## 1. Garantias e Escopo do Reset (Objetivo 1 a 5)

| Pilar | Garantia Técnica Aplicada |
|---|---|
| **Projeto & Banco** | Bloqueio rígido contra `itissimple-8663d`; exige confirmação explícita `itissimple-security-staging`; alvo exclusivo banco `(default)` (ignora ID secundário listado em `firebase-applet-config.json`, conforme ARCH.2 / HOTFIX 4B.18). |
| **Firebase Authentication** | **100% preservado.** O script nunca chama `accounts:delete`, `accounts:update` ou alteração de `customClaims` / UIDs / provedores. |
| **Reset dos 4 Usuários Reais** | Perfis Firestore, subcoleções (rotinas, homework, Journal, Dictionary, histórico semanal, agendamentos/aulas, notas), vínculos, disponibilidade, aulas, Native Friends Notes, insights, mensagens e transações financeiras de teste são **incluídos na limpeza**, mesmo quando vinculados aos UIDs/e-mails dos 4 usuários reais. |
| **Proteção de Admin** | `users/{adminUid}` (somente UID autenticado com claim `admin` / `adm.itissimple@gmail.com`) é sanitizado *in-place* para manter apenas identidade mínima (`uid`, `id`, `email`, `name`, `role: 'admin'`, `isBootstrappedAdmin`, `bootstrappedAt`, `createdAt`, `updatedAt`), removendo qualquer campo de teste; todas as suas subcoleções de teste são excluídas. |
| **Eliminação de `app_state/*`** | Remove monólitos (`app_state/assignments`, `app_state/main`, `app_state/test-*`) e sanitiza `main_data`, `routines`, `tutors` e `lessons` para remover todos os resíduos de teste e caches (`meetSettings`, `teacherSettings`, `chatMessages`, `dictionary`, `studentActivityJournal`, `studentSpotifyCycles`, `tutorsList`, `contractedLessons`, etc.). |
| **Backup Integral Restaurável** | **Exige `gcloud firestore export` para bucket GCS (`--gcs-bucket gs://...`)**, validado via `.overall_export_metadata`. Os arquivos locais `firestore-default-export.json` e `auth-users-sanitized.json` contêm campos `[REDACTED]` e são explicitamente classificados como **apenas auditoria offline (NÃO restauráveis)**. |
| **Execução Segura** | Manifesto `COMPLETED` + checksums SHA-256 + `planHash` + trava atômica `_maintenance_locks/arch_2g_cleanup` + precondição otimista `currentDocument.updateTime` + exclusão da subcoleção mais profunda para a raiz + `--resume` idempotente via `execution-journal.jsonl`. |

---

## 2. Mapa Exato de Caminhos no Firestore `(default)`

### A. 100% Preservado (`PRESERVE`)
- **Firebase Authentication** (fora do Firestore): todas as 4+ contas, UIDs, e-mails e `customClaims` (incluindo `{ role: 'admin' }` em `adm.itissimple@gmail.com`).
- `app_state/admin_bootstrap` — Trava única do administrador.
- `app_state/youtube_playlists` — Catálogo estrutural de playlists do YouTube.
- `app_state/youtube_auth` — Credenciais OAuth estruturais do canal (preservado integralmente no Firestore; redactado apenas no JSON local de auditoria).
- `ptax_rates/{date}` — Cache estrutural de cotações BACEN PTAX.
- `_maintenance_locks/arch_2g_cleanup` — Trava operacional temporária durante execução (criada e removida apenas na janela de manutenção).

### B. Sanitizado In-Place (`SANITIZE_FIELDS` via `PATCH` + `updateMask`)
| Caminho | Campos Preservados | Campos Removidos / Zerados |
|---|---|---|
| `app_state/main_data` | `landingContent`, `spotifyPlaylists`, `updatedAt` | **Todos os demais**, incluindo `userProfiles`, `authUsers`, `students`, `deletedStudentEmails`, `deletedTutorEmails`, `deletedTutorIds`, `meetSettings`, `teacherSettings`, `chatMessages`, `dictionary`, `studentActivityJournal`, `studentJournalMap`, `studentDictionaryMap`, `sessionNotesMap`, `sessionNotesProgressMap`, `pedagogicalTransformationsMap`, `liveLessons`, `lessons`, `scheduledLessons`, `weeklyHomework`, `studentHomeworkMap`, `studentRoutinesMap`, `studentCurrentRoutines`, `routinesByDay`, `studentWeeklyChecks`, `weeklyNativeTargets`, `studentVideoAssignments`, `studentSpotifyAssignments`, `studentWatchedVideos`, `studentListenedTracks`, `studentAwaitingTopicSelection`, `weeklyStudyDays`, `weeklyStudyDaysTargets`, `tutorsList`, `teachers`, `contractedLessons`, `emailLogs`, `transactions`, `studentSpotifyCycles`, `cycleAttempts` e flags redundantes de bootstrap. |
| `app_state/routines` | `routinesByDay` (template padrão estrutural), `updatedAt` | `studentRoutinesMap`, `studentCurrentRoutines`, `weeklyNativeTargets`, `studentWeeklyChecks` e qualquer mapa residual de alunos. |
| `app_state/tutors` | `teachers` (filtrado apenas para registros `role === 'admin'` validados no Auth), `updatedAt` | `tutorsList`, `deletedTutorEmails`, `deletedTutorIds` e entradas de tutores não-admin. |
| `app_state/lessons` | `contractedLessons: {}` (zerado), `updatedAt` | `liveLessons`, `lessons`, `scheduledLessons`, `weeklyHomework`, `studentHomeworkMap` e todos os saldos de aulas contratadas de teste dos 4 usuários. |
| `users/{adminUid}` *(apenas raiz do admin verificado no Auth)* | `uid`, `id`, `email`, `name`, `role: 'admin'`, `isBootstrappedAdmin`, `bootstrappedAt`, `createdAt`, `updatedAt` | Todos os campos de teste de aluno/professor (ex.: nível, onboarding, rotina, créditos, agenda, meetUrl, senha legada), garantindo ausência de conflito de papel em `resolveCanonicalUserRoleAndIdentity`. |

### C. Excluído Integralmente (`DELETE_DOC` — folhas/subcoleções antes dos pais)
Inclui **inclusive documentos vinculados aos UIDs/e-mails dos 4 usuários reais**:
- **Perfis e subcoleções em `users/`:**
  - `users/{uid}` (todos os documentos cuja raiz não seja o `adminUid` verificado).
  - `users/{anyUid}/routines/{docId}`
  - `users/{anyUid}/currentRoutine/{docId}` (`weekData`, `week-*`)
  - `users/{anyUid}/weeklyChecks/{docId}`
  - `users/{anyUid}/homework/{docId}` (`week-*`, `current_week`)
  - `users/{anyUid}/weeklyHistory/{docId}`
  - `users/{anyUid}/vocabulary/{wordId}` (**Dictionary**)
  - `users/{anyUid}/journal/{entryId}` (**Journal**)
  - `users/{anyUid}/activity_journal/{entryId}` (**Activity Journal**)
  - `users/{anyUid}/studentJournal/{entryId}` (Journal legado)
  - `users/{anyUid}/session_notes/{docId}` (ex.: `review_cycle`, espelhos legados)
  - `users/{anyUid}/lessons/{lessonId}` (**Agendamentos / Aulas espelhadas por usuário**)
  - `users/{anyUid}/memorization/{docId}` e qualquer outra subcoleção sob `users/{anyUid}/*`.
- **Perfis de tutores, vínculos e agenda:**
  - `tutors/{uid}` e `tutors/{uid}/lessons/{lessonId}`
  - `student_assignments/{uid}` (**Vínculos aluno ↔ Native Friend**)
  - `teacher_availability/{uid}` (**Grade de disponibilidade / agendamentos**)
- **Aulas, Native Friends Notes, mensagens, insights e financeiro:**
  - `lessons/{lessonId}`
  - `session_notes/{noteId}/pedagogical_cache/{cacheKey}` *(excluído antes do pai)*
  - `session_notes/{noteId}` (**Native Friends Notes**)
  - `direct_messages/{msgId}`
  - `lesson_insights/{insightId}`
  - `financial_transactions/{txId}` (**Registros financeiros de teste**)
- **Resíduos `app_state/*` e coleções descontinuadas/efêmeras:**
  - `app_state/assignments`, `app_state/main`, `app_state/test-*`, `app_state/diag-*`, `app_state/probe-*`, `app_state/mock-*`, `app_state/seed-*`, `app_state/*connectivity_check*`
  - `live_lessons/*`, `student_homework/*`, `_diagnostic_probes/*`, `gemini_inflight_locks/*`, `gemini_rate_limits/*`

### D. Revisão Manual (`REVIEW`)
- Qualquer coleção raiz desconhecida fora da lista acima (e sem prefixo de teste) nunca é apagada automaticamente.

---

## 3. Prevenção Contra Restauração de `app_state` por Processos Ativos e Caches

Em `serverApp.ts`, instâncias Node em execução mantêm `inMemoryDb` em RAM e executam `saveAppStateToFirestore(inMemoryDb)` com `{ merge: true }`. Se uma instância antiga continuar rodando durante ou após o reset, ela regravará `app_state/*` (inclusive `tutorsList`, `students`, `meetSettings`, `studentRoutinesMap`) a partir da RAM.

**Sequência obrigatória anti-restauração:**
1. **Antes do `--execute-clean`:**
   - Encerrar servidores locais / preview AI Studio (`tsx server.ts`) conectados ao projeto `itissimple-security-staging`.
   - Fechar todas as abas do navegador abertas com a aplicação para os 4 usuários de teste (evitando re-sync automático de hooks no frontend e mantendo `localStorage` / IndexedDB limpos).
   - O `--execute-clean --quiesce-cloud-run` valida Cloud Run, Cloud Functions e Cloud Scheduler; aplica **`DIAGNOSTIC_ONLY=true`** no Cloud Run antes da limpeza (drenando revisões antigas e desativando `initCloudPersistence()`, `writeDb()` e `writeDbSync()`).
2. **Durante `--execute-clean`:**
   - A trava `_maintenance_locks/arch_2g_cleanup` bloqueia execuções concorrentes e `currentDocument.updateTime` aborta caso qualquer escritor externo altere um documento após o backup.
3. **Após `--execute-clean`:**
   - O bloco `finally` restaura a variável `DIAGNOSTIC_ONLY` no Cloud Run, forçando o Cloud Run a subir uma **nova revisão com `inMemoryDb = DEFAULT_DB`** (RAM limpa), que hidrata exclusivamente a partir do Firestore já resetado.
   - Limpar `localStorage` / dados do site nas abas dos 4 usuários antes de autenticar novamente.

---

## 4. Procedimento de Backup Integral e Restauração (Rollback)

> ⚠️ **Regra Crítica:** O arquivo local `firestore-default-export.json` possui `token`, `password`, `apiKey` e `secret` mascarados como `[REDACTED]`. Ele é **estritamente um artefato de auditoria/planejamento** (`isIntegralRestorableBackup: false`) e **NUNCA** deve ser usado para restauração. O script **bloqueia** `--execute-clean` se não houver export gerenciado válido no Google Cloud Storage (`restorableBackup.type === "gcs_managed_export"`).

### A. Criação do Backup Integral (via `--backup-only`)
1. Garantir um bucket GCS no projeto `itissimple-security-staging` (ex.: `gs://itissimple-security-staging-backups`, mesma região do Firestore `(default)` ou multiregional compatível).
2. Rodar `--backup-only --gcs-bucket gs://itissimple-security-staging-backups`.
3. O script executa nativamente `gcloud firestore export` para `gs://.../arch2g2-itissimple-security-staging-<timestamp>`, verifica `*.overall_export_metadata` via `gcloud storage ls` e registra a URI exata em `backup-manifest.json` (`restorableBackup.gcsExportUri`).

### B. Procedimento de Restauração Integral (Rollback em caso de emergência)
Se for necessário reverter o banco `(default)` ao estado exato pré-reset:
1. **Isolar escritores antes da importação:**
   - Parar servidores locais/preview (`tsx server.ts`) e colocar Cloud Run (se houver) em `DIAGNOSTIC_ONLY=true`:
     ```bash
     # Substitua SERVICE e REGION pelos valores listados em backup-manifest.json
     gcloud run services update SERVICE --project=itissimple-security-staging --region=REGION --update-env-vars=DIAGNOSTIC_ONLY=true
     ```
2. **Obter a URI verificada do backup integral:**
   ```bash
   GCS_EXPORT_URI="$(jq -r '.restorableBackup.gcsExportUri' "$BACKUP_DIR/backup-manifest.json")"
   echo "$GCS_EXPORT_URI"
   gcloud storage ls "${GCS_EXPORT_URI}/*.overall_export_metadata" --project=itissimple-security-staging
   ```
3. **Importar o backup integral de volta para `(default)`:**
   ```bash
   gcloud firestore import "$GCS_EXPORT_URI" \
     --project=itissimple-security-staging \
     --database='(default)'
   ```
   *(Nota: `gcloud firestore import` realiza upsert/sobrescrita dos documentos existentes no snapshot. Caso documentos novos de teste tenham sido criados após o reset e devam ser descartados antes do rollback, limpe-os previamente.)*
4. **Restaurar aplicação limpa (nova revisão sem `DIAGNOSTIC_ONLY=true`):**
   ```bash
   gcloud run services update SERVICE --project=itissimple-security-staging --region=REGION --remove-env-vars=DIAGNOSTIC_ONLY
   ```

---

## 5. Comandos Mínimos para Google Cloud Shell (Somente Após Aprovação)

```bash
# 1. Conferir projeto e bucket no Cloud Shell
gcloud auth list
gcloud config set project itissimple-security-staging
chmod +x ./scripts/cloudshell-firestore-clean.sh

# (Apenas na primeira vez, se o bucket ainda não existir — consulte a localização do Firestore):
gcloud firestore databases describe --database='(default)' --project=itissimple-security-staging --format='value(locationId)'
# Ex.: gs bucket na mesma localização (ou us multi-region se aplicável):
# gcloud storage buckets create gs://itissimple-security-staging-backups --project=itissimple-security-staging --location=southamerica-east1 --uniform-bucket-level-access

# 2. BACKUP INTEGRAL + INVENTÁRIO ARCH.2G.2 (SOMENTE LEITURA)
./scripts/cloudshell-firestore-clean.sh --backup-only \
  --project itissimple-security-staging \
  --gcs-bucket gs://itissimple-security-staging-backups

# 3. INSPECIONAR RELATÓRIO E CONFERIR URI DE RESTAURAÇÃO + PLAN HASH
BACKUP_DIR="$(ls -td "$HOME"/itissimple-arch2g2-backups/itissimple-security-staging-* | head -n1)"
cat "$BACKUP_DIR/inventory-report.md"
jq '{gcsExportUri: .restorableBackup.gcsExportUri, counts: .counts, planHash: .checksums.planHash}' "$BACKUP_DIR/backup-manifest.json"
```

Somente após revisar o `inventory-report.md`, encerrar processos locais/abas abertas dos 4 usuários e confirmar que `gcsExportUri` foi verificado:

```bash
# 4. EXECUTAR RESET CONTROLADO (exigirá digitar "CONFIRMAR LIMPEZA itissimple-security-staging")
PLAN_HASH="$(jq -r '.planHash' "$BACKUP_DIR/cleanup-plan.json")"
./scripts/cloudshell-firestore-clean.sh --execute-clean \
  --backup-dir "$BACKUP_DIR" \
  --confirm-project itissimple-security-staging \
  --confirm-plan-hash "$PLAN_HASH" \
  --quiesce-cloud-run \
  --acknowledge-no-active-writers

# (Em caso de interrupção no meio, retomar de forma idempotente com --resume:)
./scripts/cloudshell-firestore-clean.sh --execute-clean --resume \
  --backup-dir "$BACKUP_DIR" \
  --confirm-project itissimple-security-staging \
  --confirm-plan-hash "$PLAN_HASH" \
  --quiesce-cloud-run \
  --acknowledge-no-active-writers
```
