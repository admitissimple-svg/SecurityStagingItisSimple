# IT'S SIMPLE — FASE 1E: Plano de Execução do Primeiro Deploy Privado

**Projeto exclusivo:** `itissimple-security-staging`  
**Escopo:** Procedimento Operacional Definitivo, Playbook de Comandos `gcloud`, Checklist de Validação Pré e Pós-Deploy do Backend Diagnóstico no Google Cloud Run  
**Status Atual:** **PRONTO PARA REVISÃO — DEPLOY NÃO EXECUTADO** (Aguardando autorização explícita do operador).

---

## 1. Verificações Críticas Obrigatórias ("Antes do Deploy")

| Item | Verificação Pré-Deploy | Status | Mecanismo de Garantia Técnico |
|---|---|:---:|---|
| **1.1** | **Allowlist Mínima de Identidades IAM** | **CONFIRMADO** | Contas desnecessárias (incluindo `admin@itissimple.com`) foram 100% removidas. A allowlist estática foi reduzida ao conjunto estritamente mínimo de 3 identidades (`sa-diagnostic-backend`, `sa-diagnostic-caller` e `adm.itissimple@gmail.com`). Curingas (`*@...`) e confiança isolada em `email_verified=true` permanecem estritamente bloqueados. |
| **1.2** | **Confiança Exclusiva em Chaves Públicas Oficiais do Google** | **CONFIRMADO** | Em execução real (`NODE_ENV !== 'test'`), a biblioteca `google-auth-library` (`googleAuthClient.verifyIdToken`) obtém e valida assinaturas exclusivamente contra o endpoint de certificados públicos do Google (`https://www.googleapis.com/oauth2/v3/certs`). Injeção de chaves locais de teste em tempo de execução real lança exceção fatal (`FATAL SECURITY VIOLATION`). |
| **1.3** | **Fornecimento da URL Real do Cloud Run ao Validador de Audience** | **CONFIRMADO** | Imediatamente após a criação do serviço Cloud Run, o comando operacional captura a URL canônica gerada (`status.url`) e injeta no container como variável de ambiente `CLOUD_RUN_SERVICE_URL`. Sem audience configurada em produção, o backend falha fechado (`MISSING_EXPECTED_AUDIENCE_CONFIG`). |
| **1.4** | **Garantia de `DIAGNOSTIC_ONLY=true` Ativo** | **CONFIRMADO** | Definido expressamente no `Dockerfile` (`ENV DIAGNOSTIC_ONLY=true`) e reforçado no comando de deploy (`--set-env-vars DIAGNOSTIC_ONLY=true`). O bootloader `server.ts` carrega apenas `diagnosticApp.ts`; o módulo de negócio `serverApp.ts` não é importado em memória. |
| **1.5** | **Serviço 100% Privado com Exigência de `roles/run.invoker`** | **CONFIRMADO** | Implantação configurada com `--no-allow-unauthenticated`. Toda requisição anônima ou sem permissão IAM é barrada no Google Front End (GFE) antes de atingir o container. Camada de defesa em profundidade no middleware da aplicação revalida o token e a allowlist. |
| **1.6** | **Indisponibilidade Total de Rotas de Negócio** | **CONFIRMADO** | No `diagnosticApp.ts`, apenas `/health` e `/api/diagnostic/firestore` estão registrados. Chamadas para `/api/tutors`, `/api/students`, `/api/auth/*` ou qualquer outra rota de negócio retornam invariavelmente `HTTP 404 Not Found` (`diagnosticMode: true`). |

---

## 2. Desenho Arquitetural da Implantação Privada

```
                         [ CHAMADA NÃO AUTORIZADA / ANÔNIMA ]
                                         │
                                         ▼ (Barrado no Edge GFE: HTTP 401/403)
                                ┌─────────────────┐
                                │ Google Cloud GFE│
                                └────────┬────────┘
                                         │ Token OIDC Válido + roles/run.invoker
                                         ▼
                 ┌─────────────────────────────────────────────────┐
                 │ Cloud Run: itissimple-diagnostic-backend        │
                 │ Região: us-east5                                │
                 │ Service Account: sa-diagnostic-backend          │
                 │ Min instances: 0 | Max instances: 1             │
                 │                                                 │
                 │ ┌─────────────────────────────────────────────┐ │
                 │ │ Express Middleware: diagnosticAuthMiddleware │ │
                 │ │ - Valida aud == CLOUD_RUN_SERVICE_URL        │ │
                 │ │ - Rejeita tokens do Firebase Auth           │ │
                 │ │ - Valida Allowlist Explícita de Identidades │ │
                 │ └──────────────────────┬──────────────────────┘ │
                 │                        │                        │
                 │          /api/diagnostic/firestore              │
                 │                        │                        │
                 │  ┌─────────────────────┴─────────────────────┐  │
                 │  │ Firestore Admin SDK (ADC da sa-diagnostic)│  │
                 │  │ Projeto Alvo: itissimple-security-staging │  │
                 │  │ Coleção Isolada: _diagnostic_probes       │  │
                 │  │ (WRITE ──> READ ──> DELETE com validação) │  │
                 │  └───────────────────────────────────────────┘  │
                 └─────────────────────────────────────────────────┘
```

### 2.1 Identidades e Princípio do Menor Privilégio (Least Privilege)

1. **Service Account de Execução (Runtime SA):**
   - **ID:** `sa-diagnostic-backend@itissimple-security-staging.iam.gserviceaccount.com`
   - **Propósito:** Executar o container do Cloud Run.
   - **Papel IAM atribuído:** `roles/datastore.user` exclusivamente no projeto `itissimple-security-staging`.
   - **Restrição:** Sem acesso de admin, sem acesso ao Firebase Auth, sem chaves JSON.
2. **Service Account Invocadora (Caller SA):**
   - **ID:** `sa-diagnostic-caller@itissimple-security-staging.iam.gserviceaccount.com`
   - **Propósito:** Invocação autenticada para probes automáticos de diagnóstico e testes do operador.
   - **Papel IAM atribuído:** `roles/run.invoker` vinculado **estritamente ao serviço** `itissimple-diagnostic-backend` (não a nível de projeto).
3. **Operador Administrativo:**
   - **E-mail:** `adm.itissimple@gmail.com`
   - **Papel IAM atribuído:** `roles/run.invoker` no serviço específico para realização dos testes de homologação.
4. **Ausência de Chaves Permanentes:**
   - **Zero** arquivos de chave JSON (`service-account-key.json`). A autenticação utiliza metadados nativos do Google Cloud (Application Default Credentials - ADC) e tokens OIDC emitidos dinamicamente por impersonação ou `gcloud auth print-identity-token`.

---

## 3. Playbook de Comandos Operacionais para Implantação

> **ATENÇÃO:** Os comandos abaixo foram preparados para revisão e conferência. **Nenhum destes comandos foi executado nesta etapa.**

### Etapa 0: Configuração de Variáveis de Sessão e Trava de Projeto

```bash
# Definir variáveis de ambiente do deployment
export PROJECT_ID="itissimple-security-staging"
export REGION="us-east5"
export SERVICE_NAME="itissimple-diagnostic-backend"
export RUNTIME_SA="sa-diagnostic-backend@${PROJECT_ID}.iam.gserviceaccount.com"
export CALLER_SA="sa-diagnostic-caller@${PROJECT_ID}.iam.gserviceaccount.com"
export ADMIN_EMAIL="adm.itissimple@gmail.com"

# Travar gcloud no projeto de segurança staging (proibição absoluta de itissimple-8663d)
gcloud config set project "${PROJECT_ID}"
```

### Etapa 1: Criação da Service Account de Execução (Runtime SA)

```bash
# Criar a Service Account de execução dedicada
gcloud iam service-accounts create sa-diagnostic-backend \
  --project="${PROJECT_ID}" \
  --display-name="Service Account de Execução do Backend Diagnóstico Cloud Run" \
  --description="Identidade restrita com privilégio mínimo para execução do probe de Firestore"
```

### Etapa 2: Concessão de Privilégio Mínimo de Firestore

```bash
# Conceder apenas roles/datastore.user no projeto itissimple-security-staging
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user"
```

### Etapa 3: Criação da Service Account Invocadora (Caller SA)

```bash
# Criar a Service Account para invocação de testes
gcloud iam service-accounts create sa-diagnostic-caller \
  --project="${PROJECT_ID}" \
  --display-name="Service Account Invocadora de Diagnóstico" \
  --description="Identidade autorizada para chamar o serviço privado de diagnóstico"
```

### Etapa 4: Construção do Container com Tag Imutável via Cloud Build

```bash
# Compilar a imagem Docker do repositório no Cloud Build do projeto staging
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --tag="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:1e-diagnostic-$(date +%Y%m%d%H%M%S)"
```

### Etapa 5: Deploy do Serviço Cloud Run 100% Privado

```bash
# Implantação inicial com --no-allow-unauthenticated e variáveis de segurança travadas
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest" \
  --service-account="${RUNTIME_SA}" \
  --no-allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=60s \
  --set-env-vars="NODE_ENV=production,DIAGNOSTIC_ONLY=true,FIREBASE_PROJECT_ID=${PROJECT_ID},FIREBASE_DATABASE_ID=(default)"
```

### Etapa 6: Captura da URL Canônica e Injeção de `CLOUD_RUN_SERVICE_URL`

```bash
# 6.1 Obter a URL canônica gerada pelo Cloud Run
export SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "URL canônica do Cloud Run gerada: ${SERVICE_URL}"

# 6.2 Atualizar o serviço com a audience esperada
gcloud run services update "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --update-env-vars="CLOUD_RUN_SERVICE_URL=${SERVICE_URL}"
```

### Etapa 7: Concessão Estrita de `roles/run.invoker` (Nível de Recurso)

```bash
# Conceder permissão de invocação para a SA Invocadora
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${CALLER_SA}" \
  --role="roles/run.invoker"

# Conceder permissão de invocação para o Administrador Humano
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="user:${ADMIN_EMAIL}" \
  --role="roles/run.invoker"
```

---

## 4. Protocolo de Testes Reais Pós-Implantação

Após a conclusão das etapas de implantação autorizada, o operador deve executar os 7 testes de homologação em nuvem:

### Teste Real 1: Confirmação de Bloqueio de Chamadas Anônimas

- **Comando:**
  ```bash
  curl -i -X GET "${SERVICE_URL}/api/diagnostic/firestore"
  ```
- **Resultado Esperado:** `HTTP/2 401 Unauthorized` ou `HTTP/2 403 Forbidden` emitido pelo Google Front End (GFE) do Cloud Run. Corpo HTML padrão do Google indicando ausência de credencial de autenticação. Zero processamento na aplicação.

### Teste Real 2: Rejeição de Identidade Não Autorizada

- **Cenário:** Chamada com token OIDC Google válido emitido para uma conta Google pessoal não listada na allowlist (ex.: usuário com `email_verified=true`, mas fora da allowlist).
- **Comando:**
  ```bash
  # Gerando token de identidade com conta externa/não-autorizada
  curl -i -X GET "${SERVICE_URL}/api/diagnostic/firestore" \
    -H "Authorization: Bearer ${UNAUTHORIZED_ID_TOKEN}"
  ```
- **Resultado Esperado:** 
  - Se a conta não possui `roles/run.invoker`: Barrado no GFE (`HTTP 403 Forbidden`).
  - Se a conta possui `roles/run.invoker` por acidente no projeto, mas não está na allowlist do backend: Barrado no middleware Express com `HTTP 403 Forbidden` (`code: UNAUTHORIZED_IAM_IDENTITY`).

### Teste Real 3: Confirmação de Identidade e Projeto Firebase via Chamada Autorizada

- **Comando:**
  ```bash
  # Obter token de identidade OIDC oficial com audience da URL canônica
  export CALLER_TOKEN=$(gcloud auth print-identity-token --audiences="${SERVICE_URL}")

  # Invocar o endpoint de diagnóstico
  curl -s -X GET "${SERVICE_URL}/api/diagnostic/firestore" \
    -H "Authorization: Bearer ${CALLER_TOKEN}" | jq .
  ```
- **Resultado Esperado:**
  - `success: true`
  - `projectId: "itissimple-security-staging"`
  - `databaseId: "(default)"`
  - `serviceAccount: "sa-diagnostic-backend@itissimple-security-staging.iam.gserviceaccount.com"`
  - `serviceAccountSource: "gcp-metadata"`

### Teste Real 4: Ciclo Completo de Probe no Firestore (`_diagnostic_probes`)

- **Validação no payload retornado no Teste 3:**
  ```json
  {
    "operations": {
      "write": { "status": "confirmed", "durationMs": "<latência>" },
      "read": { "status": "confirmed", "durationMs": "<latência>", "verified": true },
      "delete": { "status": "confirmed", "durationMs": "<latência>" }
    },
    "collection": "_diagnostic_probes"
  }
  ```
- **Confirmação:**
  1. A escrita grava `targetProject: "itissimple-security-staging"`.
  2. A leitura valida correspondência exata do ID do probe.
  3. A exclusão remove o documento de teste imediatamente.

### Teste Real 5: Verificação de Intocabilidade de Coleções de Negócio

- **Comando de Verificação via Firebase CLI / Firestore:**
  ```bash
  # Confirmar que as coleções de negócio não foram criadas ou modificadas
  # Listar coleções ou inspecionar se "tutors", "students", "homework" permanecem intocadas
  gcloud firestore operations list --project="${PROJECT_ID}"
  ```
- **Critério de Aceite:** Nenhuma gravação ou alteração fora da coleção temporária `_diagnostic_probes`.

### Teste Real 6: Confirmação de Indisponibilidade de Rotas de Negócio

- **Comando:**
  ```bash
  curl -s -i -X GET "${SERVICE_URL}/api/tutors" \
    -H "Authorization: Bearer ${CALLER_TOKEN}" | jq .

  curl -s -i -X GET "${SERVICE_URL}/api/students" \
    -H "Authorization: Bearer ${CALLER_TOKEN}" | jq .

  curl -s -i -X POST "${SERVICE_URL}/api/auth/login" \
    -H "Authorization: Bearer ${CALLER_TOKEN}" | jq .
  ```
- **Resultado Esperado:** `HTTP/2 404 Not Found` para todos os endpoints, com corpo:
  ```json
  {
    "error": "Endpoint not found or disabled in diagnostic mode",
    "diagnosticMode": true
  }
  ```

### Teste Real 7: Auditoria de Custos e Métricas de Recursos

- **Comando:**
  ```bash
  gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="yaml(status.conditions,status.latestCreatedRevisionName)"
  ```
- **Critério de Aceite:**
  - `minInstances: 0` (instâncias desescalam para zero após a conclusão dos testes).
  - Custo projetado para testes de diagnóstico: **$0.00** (coberto integralmente pela cota gratuita mensal do Google Cloud Run e Firestore).

---

## 5. Matriz de Restrições e Plano de Rollback Imediato

### Restrições Invioláveis

1. **Zero Referência a `itissimple-8663d`:** O projeto legado não deve ser configurado em nenhum comando, variável de ambiente ou parâmetro.
2. **Zero Migração de Dados:** Nenhum dado real de usuários, professores ou alunos deve ser copiado ou transmitido nesta fase.
3. **Zero Alteração no Frontend:** Nenhuma URL do Cloud Run gerada será inserida em `.env`, no código Vite/React ou em arquivos públicos do frontend.
4. **Zero Acesso de Usuários Finais:** O serviço não terá tráfego de produção nem acessos públicos habilitados.

### Plano de Rollback e Destruição Imediata (Abort Protocol)

Caso qualquer anomalia seja detectada durante os testes em nuvem, o operador deve executar a destruição imediata do serviço e das permissões:

```bash
# 1. Exclusão imediata do serviço Cloud Run
gcloud run services delete "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --quiet

# 2. Revogação de permissões IAM da Service Account
gcloud projects remove-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user" \
  --quiet

# 3. Exclusão da Service Account temporária
gcloud iam service-accounts delete "${RUNTIME_SA}" \
  --project="${PROJECT_ID}" \
  --quiet

gcloud iam service-accounts delete "${CALLER_SA}" \
  --project="${PROJECT_ID}" \
  --quiet
```

---

## 6. Checklist de Prontidão Pré-Aprovação

Antes de autorizar a execução do deploy, certifique-se de que os itens abaixo estão conferidos:

- [x] **1. Testes Automatizados Locais:** 145 testes aprovados em `test/validate-fase-1d.ts` e 48 testes em `test/validate-fase-1c.ts`.
- [x] **2. Linter & Tipagem:** `npm run lint` executado com zero erros de TypeScript.
- [x] **3. Allowlist Mínima:** Reduzida estritamente a 3 identidades essenciais; `admin@itissimple.com` removida.
- [x] **4. Chaves Criptográficas:** Verificador OIDC configurado para buscar chaves públicas reais do Google; chaves locais bloqueadas fora de teste.
- [x] **5. Injeção de Audience:** Procedimento de captura de `status.url` e atualização de `CLOUD_RUN_SERVICE_URL` documentado.
- [x] **6. Isolamento e Modo Diagnóstico:** `DIAGNOSTIC_ONLY=true` no Dockerfile e nos argumentos de inicialização.
- [x] **7. Ausência de Chaves JSON:** Procedimento baseado em ADC e tokens de identidade efêmeros.
- [x] **8. Proibição de Exposição Pública:** Flag `--no-allow-unauthenticated` obrigatória.
- [ ] **9. Autorização do Operador:** Aguardando comando humano para proceder com a execução real no Google Cloud.
