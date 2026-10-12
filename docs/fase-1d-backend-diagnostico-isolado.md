# IT'S SIMPLE — FASE 1D: Backend Diagnóstico Isolado (Ajuste Final IAM)

**Projeto Exclusivo:** `itissimple-security-staging`  
**Escopo:** Alinhamento à Autenticação IAM Nativa do Cloud Run, Isolamento do Diagnóstico e Eliminação de Segredos Estáticos  
**Status da Fase:** Preparação local e testes 100% concluídos. **Nenhum deploy ou recurso em nuvem criado.**

---

## 1. Arquitetura e Alinhamento à Autenticação IAM Nativa

Para viabilizar o deploy técnico de diagnóstico autorizado condicionalmente pela Auditoria 1C.1, a aplicação foi alinhada nativamente ao modelo de segurança IAM do Google Cloud Run:

### 1.1 Eliminação Completa de Segredos Estáticos
- A dependência de `DIAGNOSTIC_AUTH_TOKEN`, `ADMIN_BEARER_TOKEN`, bem como qualquer comparação com chaves estáticas ou senhas compartilhadas, foi **100% removida do código, do ambiente e dos testes**.
- A autorização administrativa depende exclusivamente de **tokens de identidade OIDC assinados pelo Google Cloud IAM**.

### 1.2 Autenticação Nativa Cloud Run e Defesa em Profundidade
1. **Controle de Borda no Cloud Run (Nível Infraestrutura):**
   - O serviço Cloud Run deve ser implantado com `--no-allow-unauthenticated`.
   - Invocadores anônimos são barrados na borda do Google Cloud com `401 Unauthorized` ou `403 Forbidden` antes de qualquer processamento.
2. **Defesa em Profundidade na Aplicação (Nível Código):**
   - O middleware `diagnosticAuthMiddleware` intercepta o endpoint `/api/diagnostic/firestore`.
   - Se o serviço for acidentalmente exposto ou reconfigurado para `--allow-unauthenticated`, o endpoint **não fica exposto publicamente**.
   - O middleware valida criptograficamente a assinatura do token OIDC Google via `OAuth2Client` contra os certificados públicos de `accounts.google.com`.
   - Valida que o emissor (`iss`) é `https://accounts.google.com`, `email_verified: true`, e que a identidade do invocador pertence a:
     - Service Accounts do projeto staging (`*@itissimple-security-staging.iam.gserviceaccount.com`);
     - Administradores autorizados de staging (`adm.itissimple@gmail.com`, `admin@itissimple.com`);
     - Invocadores explicitamente cadastrados na variável `ALLOWED_IAM_CALLERS`.
   - Qualquer token inválido, expirado, forjado ou originário de conta Google não autorizada é rejeitado com `403 Forbidden` (`INVALID_IAM_CREDENTIALS` ou `UNAUTHORIZED_IAM_IDENTITY`).
   - Requisições anônimas são rejeitadas com `401 Unauthorized` (`MISSING_IAM_CREDENTIALS`).

---

## 2. Invariantes de Isolamento do Modo Diagnóstico

O modo `DIAGNOSTIC_ONLY=true` garante isolamento absoluto:

1. **Configuração Exclusiva de Servidor:**
   - O modo é acionado **unicamente** pela variável de ambiente `DIAGNOSTIC_ONLY=true`.
   - Parâmetros de URL (ex: `?diagnostic=true`) e cabeçalhos HTTP (ex: `X-Diagnostic: true`) são **estritamente ignorados**, impossibilitando que clientes alterem o modo do servidor.
2. **Zero Rotas de Negócio:**
   - No modo diagnóstico, rotas de alunos, professores, autenticação, financeiro, chat, etc. (`/api/tutors`, `/api/students`, `/api/auth/login`, `/api/live-lessons`, etc.) **não são registradas** e retornam `404 Not Found`.
3. **Zero Leitura ou Gravação em `app_db.json`:**
   - `loadFromDisk()` e `saveToDiskSync()` não são chamados. `app_db.json` permanece intocado (zero operações de I/O).
4. **Zero Sincronizações ou Timers em Background:**
   - `initCloudPersistence()` não é invocado. Nenhuma tarefa em segundo plano escreve no banco.

---

## 3. Endpoints Disponíveis no Modo Diagnóstico

No modo `DIAGNOSTIC_ONLY=true`, apenas os seguintes endpoints existem e respondem:

| Método | Endpoint | Autenticação Requerida | Descrição / Propósito |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | **Pública** (Liveness/Readiness Probe) | Retorna status do serviço, confirmação do modo `diagnostic_only`, `projectId` (`itissimple-security-staging`) e timestamp. |
| `GET` | `/api/diagnostic/health` | **Pública** (Overview) | Retorna visão geral de prontidão diagnóstica, confirmação de projeto, banco e Service Account. |
| `GET` / `POST` | `/api/diagnostic/firestore` | **Protegida (IAM Nativo)** | Executa sonda real de escrita, leitura e exclusão exclusivamente na coleção efêmera `_diagnostic_probes`. Aguarda confirmação de cada operação. Rejeita anônimos (401) e requer OIDC ID Token Google (403). |
| `GET` | `/` | **Pública** (Info) | Descreve o serviço em modo diagnóstico dedicado. |
| *Qualquer outro* | `/api/*` | — | **404 Not Found** (`diagnosticMode: true`, mensagem informativa de isolamento). |

---

## 4. Escopo e Limitação Crítica dos Testes Atuais

> ⚠️ **AVISO DE ESCOPO TÉCNICO:**  
> Os testes automatizados executados até o momento (`test/validate-fase-1d.ts`, 95/95 aprovados) são **estritamente LOCAIS e executados em memória com mocks controlados**.  
> **Eles NÃO comprovam conectividade de rede real com o Google Cloud Firestore ou Cloud Run.**  
> Eles comprovam apenas a lógica, os contratos de segurança, o isolamento de rotas, o bloqueio de CORS e o mecanismo de validação de tokens IAM.  
> A comprovação de conectividade real com o Firestore **só ocorrerá após o deploy efetivo na nuvem**, sob invocação autenticada por IAM e com a Service Account dedicada provisionada.

---

## 5. Dockerfile e Comando de Inicialização Fora de Desenvolvimento

Foi auditado e confirmado o fluxo de execução do container Docker:

1. **Dockerfile:**
   - `ENV NODE_ENV=production`
   - `ENV STANDALONE_BACKEND=true`
   - `ENV PORT=8080`
   - `ENV DIAGNOSTIC_ONLY=false` (padrão; alternado para `true` via `--set-env-vars="DIAGNOSTIC_ONLY=true"` no deploy Cloud Run).
   - `CMD ["node", "server.ts"]`
2. **Bootloader `server.ts`:**
   - Fora do ambiente de desenvolvimento (quando invocado com `node server.ts`), inicializa o loader `tsx` transparente (`node --import tsx server.ts`).
   - Se `process.env.DIAGNOSTIC_ONLY === 'true'`, importa exclusivamente `src/diagnosticApp.ts` e inicia `startDiagnosticServer()`. O arquivo `serverApp.ts` **jamais é carregado na memória**.
   - `startDiagnosticServer()` possui guarda de idempotência para evitar múltiplas escutas na mesma porta.
3. **Scripts Disponíveis (`package.json`):**
   - `"start"`: `node server.ts` (execução padrão do container Cloud Run)
   - `"start:diagnostic"`: `DIAGNOSTIC_ONLY=true node server.ts` (execução explícita de diagnóstico em produção)
   - `"dev:diagnostic"`: `DIAGNOSTIC_ONLY=true tsx server.ts` (desenvolvimento local com reload)

---

## 6. Tratamento Estrito de URLs de Backend: Zero Serviços Fictícios

1. **Eliminação de URLs Não Implantadas:**
   - Nenhuma URL fictícia (ex: `https://itissimple-backend-staging-456322168913.us-east5.run.app` ou similar) é tratada como serviço ativo ou implantado.
   - A allowlist de CORS estrita (`EXACT_STAGING_CORS_ALLOWLIST`) contém apenas os domínios reais de hosting do staging e os ambientes de desenvolvimento do AI Studio.
2. **Configuração Dinâmica Pós-Deploy:**
   - Quando o Cloud Run backend for realmente implantado pelo usuário, sua URL real será atribuída pela infraestrutura do Google Cloud e poderá ser injetada via `STAGING_BACKEND_URL` ou `ALLOWED_CORS_ORIGINS`.

---

## 7. Procedimento Futuro de Deploy com Service Account Mínima (Sob Autorização)

> 🛑 **IMPORTANTE: Nenhum comando de deploy foi executado. O procedimento abaixo é o roteiro exato pronto para execução quando for concedida a autorização humana explícita.**

### Passo 1: Criação da Service Account Dedicada de Diagnóstico
```bash
gcloud iam service-accounts create sa-diagnostic-backend \
  --project=itissimple-security-staging \
  --description="Service account dedicada ao backend de diagnóstico isolado" \
  --display-name="SA Diagnostic Backend"
```

### Passo 2: Concessão de Privilégio Mínimo (Princípio do Menor Privilégio)
```bash
gcloud projects add-iam-policy-binding itissimple-security-staging \
  --member="serviceAccount:sa-diagnostic-backend@itissimple-security-staging.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

### Passo 3: Deploy do Serviço Cloud Run Privado (IAM Obrigatório)
```bash
gcloud run deploy itissimple-backend-diagnostic \
  --project=itissimple-security-staging \
  --region=us-east5 \
  --source=. \
  --service-account="sa-diagnostic-backend@itissimple-security-staging.iam.gserviceaccount.com" \
  --set-env-vars="DIAGNOSTIC_ONLY=true,FIREBASE_PROJECT_ID=itissimple-security-staging,FIREBASE_DATABASE_ID=(default)" \
  --no-allow-unauthenticated
```

### Passo 4: Concessão de Permissão de Invocação para Administrador
```bash
gcloud run services add-iam-policy-binding itissimple-backend-diagnostic \
  --project=itissimple-security-staging \
  --region=us-east5 \
  --member="user:adm.itissimple@gmail.com" \
  --role="roles/run.invoker"
```

### Passo 5: Invocação e Validação Real da Conectividade Firestore
```bash
# Obter a URL real atribuída pelo Cloud Run
SERVICE_URL=$(gcloud run services describe itissimple-backend-diagnostic --project=itissimple-security-staging --region=us-east5 --format="value(status.url)")

# Obter o token de identidade OIDC do Google IAM para o serviço
ID_TOKEN=$(gcloud auth print-identity-token --audiences="${SERVICE_URL}")

# Executar a sonda diagnóstica real contra o Firestore
curl -X POST \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  "${SERVICE_URL}/api/diagnostic/firestore"
```

---

## 8. Checklist de Conformidade Final da Fase 1D

- [x] **Projeto Único e Bloqueado:** Código restrito estritamente a `itissimple-security-staging` (zero referências operacionais ao projeto de produção `itissimple-8663d`).
- [x] **Segredos Estáticos Eliminados:** `DIAGNOSTIC_AUTH_TOKEN` removido; autorização depende de IAM nativo (Google OIDC ID Token).
- [x] **Isolamento de Negócio:** `DIAGNOSTIC_ONLY=true` garante que nenhuma rota de negócio ou dados de alunos/professores é registrada.
- [x] **Defesa em Profundidade:** `/api/diagnostic/firestore` não pode ser acessado anonimamente nem exposto por reconfiguração acidental.
- [x] **Zero Fallback Local:** O diagnóstico não mascara indisponibilidade gravando em `app_db.json`.
- [x] **Coleção Efêmera:** Operações restritas a `_diagnostic_probes`, com auto-limpeza (delete imediato).
- [x] **Transparência de Escopo:** Documentado explicitamente que os testes atuais são locais e não provam conectividade real.
- [x] **Zero URLs Fictícias:** Nenhuma URL de serviço não implantado tratada como ativa.
- [x] **100% dos Testes Automatizados Aprovados:** 95/95 testes da Fase 1D e 48/48 testes da Fase 1C aprovados.
- [ ] **Deploy Não Executado:** Aguardando autorização humana explícita.

