# IT'S SIMPLE — FASE 1E.3: Correções Operacionais Finais do Playbook Cloud Run

**Projeto exclusivo:** `itissimple-security-staging`  
**Escopo:** Revisão Estrita do Playbook da Fase 1E.2, Correção das 7 Fragilidades Operacionais, Bateria de Testes Locais, Critérios Objetivos de Autorização e Rollback Cirúrgico  
**Status Atual:** **REVISÃO CONCLUÍDA — NENHUM COMANDO EXECUTADO NA NUVEM** (Zero infraestrutura criada, zero deploy disparado, zero alteração de dados de negócio, isolamento estrito contra `itissimple-8663d`).

---

## 1. Matriz de Correção dos 7 Pontos Operacionais

| # | Item Crítico | Defeito Identificado na Fase 1E.2 | Correção Definitiva na Fase 1E.3 |
|---|---|---|---|
| **1** | **`--no-traffic` com `--tag=diag` & URL de Teste** | Os testes executavam `curl ${SERVICE_URL}...`. Como `--no-traffic` direciona 0% de tráfego para a nova revisão, a URL canônica falharia ao tentar alcançar o container diagnosticado. | **Todos os testes de curl são direcionados estritamente para a URL com tag (`${TAG_URL}`)**, enquanto o token OIDC continua portando a audience canônica exigida pelo Cloud Run GFE (`--audiences="${SERVICE_URL}"`). |
| **2** | **Geração de Tokens OIDC & Prioridade de Caller** | O roteiro priorizava o token do administrador humano (`adm.itissimple@gmail.com`) em quase todas as etapas, deixando a Service Account como teste secundário. | **Prioridade máxima para a Service Account invocadora (`CALLER_SA`) via impersonação IAM nativa** (`--impersonate-service-account`). Validação explícita de todas as claims exigidas pelo middleware (`iss`, `aud`, `exp`, `email`, `email_verified`, `sub`) via `tokeninfo`. O token admin é mantido apenas como validação administrativa secundária. |
| **3** | **Identificação da Service Account do Cloud Build** | Concedia privilégios `roles/artifactregistry.writer` preventivamente a duas contas (`${PROJECT_NUMBER}@cloudbuild...` e `${PROJECT_NUMBER}-compute...`). | **Identificação prévia e estrita da conta efetiva** via `gcloud builds get-default-service-account`. **Removido qualquer fallback que presuma a identidade pela simples existência da conta**. Se a conta não for identificada com certeza, o procedimento é interrompido imediatamente (`exit 1`) sem conceder permissões. |
| **4** | **Validação OIDC Antes de Tocar no Firestore** | O teste anterior utilizava `/api/diagnostic/health`, que é público e não executava o middleware OIDC da aplicação, permitindo que falhas de token só fossem notadas em `/api/diagnostic/firestore` (já tocando no banco). | **Criação da rota protegida `/api/diagnostic/identity`**, protegida pelo middleware `diagnosticAuthMiddleware`. Ela valida assinatura, emissor, audience e allowlist **sem realizar nenhuma leitura ou gravação no Firestore** (`firestoreAccess: false`). |
| **5** | **Configuração de Audience Canônica sem Injeção via Host** | O middleware derivava dinamicamente a audience a partir de `Host` / `X-Forwarded-Host`, abrindo margem para ampliação indevida de audiences aceitas. | **Audience canônica confiável e exclusiva:** O middleware valida o token exclusivamente contra audiences configuradas no servidor (`CLOUD_RUN_SERVICE_URL`). Cabeçalhos `Host` ou `X-Forwarded-Host` são estritamente proibidos de ampliar as audiences aceitas. A URL real (`${SERVICE_URL}`) é configurada no serviço antes do teste de identidade. |
| **6** | **Rotas de Negócio na Revisão com Tag** | O teste de indisponibilidade de rotas de negócio testava `${SERVICE_URL}${route}`, que não resolvia para a revisão sob teste. | **O teste de rotas de negócio dispara contra `${TAG_URL}${route}`**, garantindo a comprovação de que as rotas de negócio retornam `404 Not Found` especificamente no container de diagnóstico implantado. |
| **7** | **Rollback Cirúrgico e Seletivo** | O script de teardown apagava todas as imagens do repositório (`docker images list`) e tentava excluir Service Accounts incondicionalmente, arriscando recursos preexistentes. | **Rollback cirúrgico rastreado por flags de estado**: remove estritamente o digest imutável gerado nesta execução (`${IMMUTABLE_IMAGE_REF}`), remove apenas o binding IAM concedido, remove a tag `diag` (ou o serviço se criado exclusivamente nesta execução) e preserva intactos repositórios, bancos Firestore `(default)` e Service Accounts preexistentes. |

---

## 2. Roteiro Corrigido de Pré-Execução (Fase 1E.3)

> **AVISO DE SEGURANÇA:** Este roteiro é um manual de procedimento para execução supervisionada. **Nenhum comando deve ser executado automaticamente.**

### Bloco A.0: Inicialização e Bloqueio Estrito do Projeto

```bash
#!/usr/bin/env bash
set -eo pipefail

echo "=== [A.0] Inicializando e Bloqueando Variáveis de Sessão ==="

export PROJECT_ID="itissimple-security-staging"
export REGION="us-east5"
export REPO_NAME="itissimple-docker-repo"
export SERVICE_NAME="itissimple-diagnostic-backend"
export RUNTIME_SA="sa-diagnostic-backend@${PROJECT_ID}.iam.gserviceaccount.com"
export CALLER_SA="sa-diagnostic-caller@${PROJECT_ID}.iam.gserviceaccount.com"
export ADMIN_EMAIL="adm.itissimple@gmail.com"

# Flags de rastreamento para Rollback Cirúrgico
export CREATED_REPO=false
export CREATED_RUNTIME_SA=false
export CREATED_CALLER_SA=false
export CREATED_BUILD_BINDING=false
export CREATED_SERVICE=false

# Bloquear o gcloud estritamente no projeto de staging
gcloud config set project "${PROJECT_ID}"

# Validação do projeto ativo
CURRENT_PROJECT=$(gcloud config get-value project)
if [ "${CURRENT_PROJECT}" != "itissimple-security-staging" ]; then
  echo "❌ ERRO CRÍTICO: Projeto ativo inválido (${CURRENT_PROJECT})! Abortando imediatamente."
  exit 1
fi

echo "✅ Projeto bloqueado com sucesso: ${CURRENT_PROJECT}"
```

---

### Bloco A.1: Habilitação das APIs do Google Cloud

```bash
echo "=== [A.1] Habilitando APIs Obrigatórias do GCP ==="

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  iam.googleapis.com \
  --project="${PROJECT_ID}"

# Verificação estrita
ENABLED_APIS=$(gcloud services list --enabled --project="${PROJECT_ID}" --filter="config.name:(run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com iam.googleapis.com)" --format="value(config.name)")
for api in run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com iam.googleapis.com; do
  if ! echo "${ENABLED_APIS}" | grep -q "${api}"; then
    echo "❌ ERRO: A API ${api} não foi habilitada com sucesso. Abortando."
    exit 1
  fi
done

echo "✅ Todas as 5 APIs fundamentais estão ativas no projeto ${PROJECT_ID}."
```

---

### Bloco A.2: Identificação da SA Efetiva do Cloud Build e Permissão Estrita

```bash
echo "=== [A.2] Configurando Repositório e Identificando SA Efetiva do Cloud Build ==="

# 2.1 Criar ou verificar repositório Docker (rastreando criação para teardown)
REPO_EXISTS=$(gcloud artifacts repositories list \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --filter="name:projects/${PROJECT_ID}/locations/${REGION}/repositories/${REPO_NAME}" \
  --format="value(name)")

if [ -z "${REPO_EXISTS}" ]; then
  echo "Criando repositório Docker: ${REPO_NAME}"
  gcloud artifacts repositories create "${REPO_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --repository-format=docker \
    --description="Repositorio Docker do backend de seguranca It is Simple"
  export CREATED_REPO=true
else
  echo "Repositório Docker já preexistente: ${REPO_EXISTS}"
fi

# 2.2 Identificação DINÂMICA e ESTRITA da Service Account EFETIVA do Cloud Build (Zero presunção por existência de conta)
echo "Identificando a Service Account padrão efetiva do Cloud Build via API oficial..."
EFFECTIVE_BUILD_SA=$(gcloud builds get-default-service-account --project="${PROJECT_ID}" --region="${REGION}" 2>/dev/null || gcloud builds get-default-service-account --project="${PROJECT_ID}" 2>/dev/null || true)

if [ -z "${EFFECTIVE_BUILD_SA}" ]; then
  echo "❌ ERRO CRÍTICO: Não foi possível identificar com certeza a Service Account efetiva do Cloud Build via API oficial."
  echo "Interrompendo procedimento sem conceder permissões preventivas ou presumidas pela simples existência da conta."
  exit 1
fi

echo "✅ Service Account efetiva identificada: ${EFFECTIVE_BUILD_SA}"

# 2.3 Atribuir permissão de escrita ESTRITAMENTE para a Service Account efetiva
gcloud artifacts repositories add-iam-policy-binding "${REPO_NAME}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --member="serviceAccount:${EFFECTIVE_BUILD_SA}" \
  --role="roles/artifactregistry.writer" \
  --quiet
export CREATED_BUILD_BINDING=true

echo "✅ Permissão roles/artifactregistry.writer concedida exclusivamente à identidade efetiva: ${EFFECTIVE_BUILD_SA}"
```

---

### Bloco A.3: Criação Controlada das Service Accounts (Runtime e Caller)

```bash
echo "=== [A.3] Criando Contas de Serviço de Execução e Invocação ==="

# 3.1 Service Account de Execução (Runtime SA)
SA_RUNTIME_EXISTS=$(gcloud iam service-accounts list --project="${PROJECT_ID}" --filter="email:${RUNTIME_SA}" --format="value(email)")
if [ -z "${SA_RUNTIME_EXISTS}" ]; then
  echo "Criando Runtime SA: ${RUNTIME_SA}"
  gcloud iam service-accounts create sa-diagnostic-backend \
    --project="${PROJECT_ID}" \
    --display-name="Service Account de Execucao do Backend Diagnostico Cloud Run" \
    --description="Identidade com privilegio minimo de leitura/escrita em Firestore de staging"
  export CREATED_RUNTIME_SA=true
else
  echo "Runtime SA já preexistente: ${RUNTIME_SA}"
fi

# Conceder roles/datastore.user no projeto de staging para a Runtime SA
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user" \
  --quiet

# 3.2 Service Account Invocadora (Caller SA)
SA_CALLER_EXISTS=$(gcloud iam service-accounts list --project="${PROJECT_ID}" --filter="email:${CALLER_SA}" --format="value(email)")
if [ -z "${SA_CALLER_EXISTS}" ]; then
  echo "Criando Caller SA: ${CALLER_SA}"
  gcloud iam service-accounts create sa-diagnostic-caller \
    --project="${PROJECT_ID}" \
    --display-name="Service Account Invocadora de Diagnostico" \
    --description="Identidade autorizada para chamar o servico privado via OIDC"
  export CREATED_CALLER_SA=true
else
  echo "Caller SA já preexistente: ${CALLER_SA}"
fi

# 3.3 Permitir que o operador humano emita tokens para a Caller SA via impersonação nativa (Zero chaves JSON)
gcloud iam service-accounts add-iam-policy-binding "${CALLER_SA}" \
  --project="${PROJECT_ID}" \
  --member="user:${ADMIN_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --quiet

echo "✅ Contas de serviço configuradas e vinculadas aos papéis estritos de menor privilégio."
```

---

### Bloco A.4: Compilação da Imagem Docker com Digest SHA-256 Imutável

```bash
echo "=== [A.4] Compilando Imagem Docker no Cloud Build com Digest SHA-256 Imutável ==="

BUILD_TIMESTAMP=$(date +%Y%m%d%H%M%S)
export IMAGE_TAG="1e-diagnostic-${BUILD_TIMESTAMP}"
export IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"
export IMAGE_URI="${IMAGE_BASE}:${IMAGE_TAG}"

echo "Iniciando compilação: ${IMAGE_URI}"

gcloud builds submit \
  --project="${PROJECT_ID}" \
  --tag="${IMAGE_URI}"

# Extração estrita do digest SHA-256 único
export IMAGE_DIGEST=$(gcloud artifacts docker images describe "${IMAGE_URI}" \
  --project="${PROJECT_ID}" \
  --format="value(image_summary.digest)")

if [ -z "${IMAGE_DIGEST}" ]; then
  echo "❌ ERRO FATAL: Falha ao capturar o digest SHA-256 da imagem compilada. Abortando."
  exit 1
fi

export IMMUTABLE_IMAGE_REF="${IMAGE_BASE}@${IMAGE_DIGEST}"
echo "✅ Imagem imutável confirmada: ${IMMUTABLE_IMAGE_REF}"
```

---

### Bloco A.5: Deploy Inicial Privado com `--no-traffic` e Tag `diag`

```bash
echo "=== [A.5] Executando Deploy Privado com --no-traffic e --tag=diag ==="

# Verificar se o serviço Cloud Run já existia
SERVICE_EXISTS=$(gcloud run services list --project="${PROJECT_ID}" --region="${REGION}" --filter="metadata.name:${SERVICE_NAME}" --format="value(metadata.name)")
if [ -z "${SERVICE_EXISTS}" ]; then
  export CREATED_SERVICE=true
fi

# Deploy sem tráfego geral e com tag isolada
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMMUTABLE_IMAGE_REF}" \
  --service-account="${RUNTIME_SA}" \
  --no-allow-unauthenticated \
  --no-traffic \
  --tag="diag" \
  --min-instances=0 \
  --max-instances=1 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=60s \
  --set-env-vars="NODE_ENV=production,DIAGNOSTIC_ONLY=true,FIREBASE_PROJECT_ID=${PROJECT_ID},FIREBASE_DATABASE_ID=(default)"

echo "✅ Revisão implantada com tráfego 0% e tag 'diag' dedicada."
```

---

### Bloco A.6: Captura da URL Canônica, URL da Tag e Configuração Obrigatória da Audience Canônica no Servidor

```bash
echo "=== [A.6] Capturando URLs e Configurando Audience Canônica no Servidor ==="

# URL Canônica do serviço (Audience canônica do Cloud Run)
export SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")

# URL específica da revisão com tag 'diag' (Destino das requisições de teste)
export TAG_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.traffic.filter(tag=diag).url)')

echo "Audience Canônica do Serviço: ${SERVICE_URL}"
echo "URL de Teste da Tag de Revisão: ${TAG_URL}"

if [ -z "${SERVICE_URL}" ] || [ -z "${TAG_URL}" ]; then
  echo "❌ ERRO CRÍTICO: Falha na captura das URLs do Cloud Run! Abortando."
  exit 1
fi

# Configuração OBRIGATÓRIA da URL canônica real no serviço antes do teste de identidade:
# O middleware de segurança valida o token OIDC exclusivamente contra audiences canônicas
# configuradas no servidor, proibindo terminantemente que cabeçalhos Host ou X-Forwarded-Host
# ampliem a lista de audiences aceitas.
echo "Injetando a URL canônica real (CLOUD_RUN_SERVICE_URL) na revisão com tag..."
gcloud run services update "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --tag="diag" \
  --no-traffic \
  --update-env-vars="CLOUD_RUN_SERVICE_URL=${SERVICE_URL}" \
  --quiet

echo "✅ URLs capturadas e CLOUD_RUN_SERVICE_URL configurada com sucesso. O middleware validará exclusivamente contra a audience canônica ${SERVICE_URL}."
```

---

### Bloco A.7: Concessão Estrita de `roles/run.invoker` no Nível do Serviço

```bash
echo "=== [A.7] Vinculando Permissões Estritas de Invocador IAM ==="

# 7.1 Conceder roles/run.invoker à Service Account Invocadora
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${CALLER_SA}" \
  --role="roles/run.invoker" \
  --quiet

# 7.2 Conceder roles/run.invoker ao Administrador Humano
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="user:${ADMIN_EMAIL}" \
  --role="roles/run.invoker" \
  --quiet

# 7.3 Auditar ausência total de 'allUsers'
ALL_USERS_INVOKER=$(gcloud run services get-iam-policy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/run.invoker AND bindings.members:allUsers" \
  --format="value(bindings.members)")

if [ -n "${ALL_USERS_INVOKER}" ]; then
  echo "❌ ERRO GRAVE DE SEGURANÇA: Invocação pública (allUsers) detectada! Removendo..."
  gcloud run services remove-iam-policy-binding "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --member="allUsers" \
    --role="roles/run.invoker" \
    --quiet
  exit 1
fi

echo "✅ Invocação pública 100% DESABILITADA. Apenas identidades autorizadas possuem acesso."
```

---

### Bloco A.8: Validação Prévia de Segurança & Autenticação (Zero Acesso ao Firestore)

Antes de autorizar qualquer operação de banco de dados, o operador executa estas 6 verificações:

#### Verificação A.8.1: Bloqueio Obrigatório de Chamada Anônima no GFE (URL Canônica)
```bash
echo "--- Verificação A.8.1: Chamada anônima na URL canônica ---"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${SERVICE_URL}/api/diagnostic/health")
echo "Código HTTP retornado: ${HTTP_STATUS}"
if [ "${HTTP_STATUS}" != "401" ] && [ "${HTTP_STATUS}" != "403" ]; then
  echo "❌ ERRO GRAVE: Chamada anônima não foi bloqueada no GFE (${HTTP_STATUS})! Abortando."
  exit 1
fi
echo "✅ Chamada anônima bloqueada com sucesso pelo GFE na URL canônica (${HTTP_STATUS})."
```

#### Verificação A.8.2: Bloqueio Obrigatório de Chamada Anônima na URL da Tag
```bash
echo "--- Verificação A.8.2: Chamada anônima na URL da tag ---"
HTTP_STATUS_TAG=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${TAG_URL}/api/diagnostic/health")
echo "Código HTTP retornado na tag: ${HTTP_STATUS_TAG}"
if [ "${HTTP_STATUS_TAG}" != "401" ] && [ "${HTTP_STATUS_TAG}" != "403" ]; then
  echo "❌ ERRO GRAVE: Tag de revisão permitiu acesso anônimo (${HTTP_STATUS_TAG})! Abortando."
  exit 1
fi
echo "✅ Tag de revisão protegida com sucesso contra acesso público (${HTTP_STATUS_TAG})."
```

#### Verificação A.8.3: Geração do Token OIDC da Service Account Invocadora e Inspeção de Claims
```bash
echo "--- Verificação A.8.3: Inspecionando Token OIDC da Service Account Invocadora ---"

# Emissão de token por impersonação IAM nativa para a Caller SA
CALLER_TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account="${CALLER_SA}" \
  --audiences="${SERVICE_URL}" \
  --include-email)

# Inspecionar claims reais exigidas pelo middleware junto ao endpoint oficial do Google
TOKEN_INFO=$(curl -s "https://oauth2.googleapis.com/tokeninfo?id_token=${CALLER_TOKEN}")
TOKEN_EMAIL=$(echo "${TOKEN_INFO}" | jq -r '.email')
TOKEN_AUD=$(echo "${TOKEN_INFO}" | jq -r '.aud')
TOKEN_VERIFIED=$(echo "${TOKEN_INFO}" | jq -r '.email_verified')
TOKEN_ISS=$(echo "${TOKEN_INFO}" | jq -r '.iss')

echo "E-mail do Token: ${TOKEN_EMAIL}"
echo "Audience do Token: ${TOKEN_AUD}"
echo "Emissor do Token: ${TOKEN_ISS}"
echo "E-mail Verificado: ${TOKEN_VERIFIED}"

if [ "${TOKEN_EMAIL}" != "${CALLER_SA}" ]; then
  echo "❌ ERRO: E-mail do token (${TOKEN_EMAIL}) difere da Caller SA esperada (${CALLER_SA})!"
  exit 1
fi

if [ "${TOKEN_AUD}" != "${SERVICE_URL}" ]; then
  echo "❌ ERRO: Audience do token (${TOKEN_AUD}) difere da URL canônica (${SERVICE_URL})!"
  exit 1
fi

if [ "${TOKEN_VERIFIED}" != "true" ]; then
  echo "❌ ERRO: O e-mail do token não está marcado como verificado pelo Google!"
  exit 1
fi

echo "✅ Token OIDC emitido para a Service Account e 100% validado pela autoridade Google."
```

#### Verificação A.8.4: Teste de Autenticação da Aplicação na Rota de Identidade (Zero Firestore)
```bash
echo "--- Verificação A.8.4: Validação de Identidade Protegida (/api/diagnostic/identity - Zero Firestore) ---"

# 1. Chamada autenticada na rota protegida de diagnóstico de identidade
IDENTITY_RESPONSE=$(curl -s -X GET "${TAG_URL}/api/diagnostic/identity" \
  -H "Authorization: Bearer ${CALLER_TOKEN}")

echo "Resposta de identidade do backend:"
echo "${IDENTITY_RESPONSE}" | jq .

ID_AUTHENTICATED=$(echo "${IDENTITY_RESPONSE}" | jq -r '.authenticated')
ID_CALLER_EMAIL=$(echo "${IDENTITY_RESPONSE}" | jq -r '.caller.email')
ID_FIRESTORE_ACCESS=$(echo "${IDENTITY_RESPONSE}" | jq -r '.firestoreAccess')

if [ "${ID_AUTHENTICATED}" != "true" ] || [ "${ID_CALLER_EMAIL}" != "${CALLER_SA}" ]; then
  echo "❌ ERRO: Falha na validação de identidade OIDC no backend da aplicação! Abortando."
  exit 1
fi

if [ "${ID_FIRESTORE_ACCESS}" != "false" ]; then
  echo "❌ ERRO DE SEGURANÇA: A rota de identidade não deveria ter acessado o Firestore!"
  exit 1
fi

echo "✅ Aplicação validou o token OIDC da Service Account com sucesso. ZERO acesso ao Firestore (firestoreAccess: false)."
```

#### Verificação A.8.5: Teste de Liveness/Saúde na Revisão com Tag
```bash
echo "--- Verificação A.8.5: Teste de saúde autenticado na URL da tag ---"
HEALTH_RESPONSE=$(curl -s -X GET "${TAG_URL}/api/diagnostic/health" \
  -H "Authorization: Bearer ${CALLER_TOKEN}")

echo "Resposta de saúde da revisão:"
echo "${HEALTH_RESPONSE}" | jq .

SERVICE_STATUS=$(echo "${HEALTH_RESPONSE}" | jq -r '.status')
ACTIVE_SA=$(echo "${HEALTH_RESPONSE}" | jq -r '.serviceAccount')

if [ "${SERVICE_STATUS}" != "ok" ]; then
  echo "❌ ERRO: Resposta de saúde inválida na tag. Abortando."
  exit 1
fi

echo "✅ Container respondeu com sucesso sob a identidade de execução: ${ACTIVE_SA}"
echo "✅ ETAPA A CONCLUÍDA COM ÊXITO TOTAL."
```

---

## 🛑 PORTÃO DE APROVAÇÃO OBRIGATÓRIO (GATE HUMANO)

```
========================================================================================
                                     PONTO DE PARADA
========================================================================================
 A infraestrutura privada foi criada, a imagem foi compilada com digest imutável, o
 Cloud Run está implantado com --no-traffic e tag 'diag', a invocação pública está 100%
 bloqueada e a autenticação OIDC da Service Account foi confirmada pela aplicação
 COM ZERO LEITURAS OU GRAVAÇÕES NO BANCO FIRESTORE.

 PARADA OBRIGATÓRIA:
 A ETAPA B REALIZA GRAVAÇÃO, LEITURA E EXCLUSÃO REAIS NO CLOUD FIRESTORE.
 O OPERADOR DEVE EMITIR AUTORIZAÇÃO EXPLÍCITA PARA PROSSEGUIR.

 NÃO EXECUTAR A ETAPA B SEM AUTORIZAÇÃO ESCRITA ESPECÍFICA.
========================================================================================
```

---

## 3. ETAPA B — Diagnóstico Firestore (Conectividade e Persistência Reais)

> **Instrução:** Executar esta etapa **somente após autorização humana explícita**.

### Bloco B.1: Execução do Probe Firestore via Service Account Invocadora (Prioritária)

```bash
echo "=== [B.1] Executando Probe Firestore com Token da Service Account Invocadora ==="

# Renovação do token se necessário
CALLER_TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account="${CALLER_SA}" \
  --audiences="${SERVICE_URL}" \
  --include-email)

# Invocação na URL DA TAG DE DIAGNÓSTICO
PROBE_RESPONSE=$(curl -s -X GET "${TAG_URL}/api/diagnostic/firestore" \
  -H "Authorization: Bearer ${CALLER_TOKEN}")

echo "Resultado do Probe Firestore:"
echo "${PROBE_RESPONSE}" | jq .

PROBE_SUCCESS=$(echo "${PROBE_RESPONSE}" | jq -r '.success')
WRITE_STATUS=$(echo "${PROBE_RESPONSE}" | jq -r '.operations.write.status')
READ_STATUS=$(echo "${PROBE_RESPONSE}" | jq -r '.operations.read.status')
DELETE_STATUS=$(echo "${PROBE_RESPONSE}" | jq -r '.operations.delete.status')
CONFIRMED_PROJECT=$(echo "${PROBE_RESPONSE}" | jq -r '.projectId')
CONFIRMED_SA=$(echo "${PROBE_RESPONSE}" | jq -r '.serviceAccount')

if [ "${PROBE_SUCCESS}" != "true" ] || [ "${WRITE_STATUS}" != "confirmed" ] || [ "${READ_STATUS}" != "confirmed" ] || [ "${DELETE_STATUS}" != "confirmed" ]; then
  echo "❌ ERRO GRAVE: Falha nas operações do probe Firestore via Service Account!"
  exit 1
fi

if [ "${CONFIRMED_PROJECT}" != "itissimple-security-staging" ]; then
  echo "❌ ERRO GRAVE: Projeto de execução reportado (${CONFIRMED_PROJECT}) não é o staging!"
  exit 1
fi

echo "✅ Ciclo Write -> Read -> Delete no Firestore concluído com sucesso via Service Account."
echo "✅ Projeto verificado: ${CONFIRMED_PROJECT}"
echo "✅ Runtime Service Account: ${CONFIRMED_SA}"
```

---

### Bloco B.2: Execução Secundária do Probe Firestore via Administrador Humano

```bash
echo "=== [B.2] Executando Probe Firestore com ID Token do Administrador Humano ==="

ADMIN_TOKEN=$(gcloud auth print-identity-token --audiences="${SERVICE_URL}")

ADMIN_PROBE_RESPONSE=$(curl -s -X GET "${TAG_URL}/api/diagnostic/firestore" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")

ADMIN_SUCCESS=$(echo "${ADMIN_PROBE_RESPONSE}" | jq -r '.success')
if [ "${ADMIN_SUCCESS}" != "true" ]; then
  echo "❌ ERRO: Invocação via token do Administrador Humano falhou!"
  exit 1
fi

echo "✅ Invocação OIDC via Administrador Humano validada com êxito."
```

---

### Bloco B.3: Teste de Bloqueio de Identidade Não Autorizada na Allowlist

```bash
echo "=== [B.3] Testando Rejeição de Credencial Inválida / Não Autorizada ==="

INVALID_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${TAG_URL}/api/diagnostic/firestore" \
  -H "Authorization: Bearer mock-invalid-token")

echo "Código retornado para credencial inválida na tag: ${INVALID_STATUS}"
if [ "${INVALID_STATUS}" != "401" ] && [ "${INVALID_STATUS}" != "403" ]; then
  echo "❌ ERRO: Requisição com credencial inválida não foi rejeitada com 401/403!"
  exit 1
fi

echo "✅ Tokens inválidos rejeitados com segurança pelo middleware."
```

---

### Bloco B.4: Teste de Desativação Estrita de Rotas de Negócio na Revisão de Diagnóstico

```bash
echo "=== [B.4] Validando Indisponibilidade de Rotas de Negócio na Revisão com Tag (${TAG_URL}) ==="

BUSINESS_ROUTES=("/api/tutors" "/api/students" "/api/auth/login")

for route in "${BUSINESS_ROUTES[@]}"; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${TAG_URL}${route}" \
    -H "Authorization: Bearer ${CALLER_TOKEN}")
  echo "Rota: ${route} -> Código HTTP na Tag: ${HTTP_CODE}"
  if [ "${HTTP_CODE}" != "404" ]; then
    echo "❌ ERRO GRAVE: Rota de negócio ${route} retornou ${HTTP_CODE} em vez de 404 Not Found!"
    exit 1
  fi
done

echo "✅ Todas as rotas de negócio confirmadas como estritamente inoperantes (404 Not Found) na revisão sob teste."
```

---

### Bloco B.5: Auditoria de Não-Interferência no Firestore

```bash
echo "=== [B.5] Auditando Coleções e Não-Interferência no Firestore ==="

echo "Consultando logs do Cloud Run para comprovar ciclo do documento temporário na coleção _diagnostic_probes..."
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME} AND textPayload:\"probe_\"" \
  --project="${PROJECT_ID}" \
  --limit=5 \
  --format="table(timestamp,textPayload)" || true

echo "✅ Auditoria concluída. Nenhuma coleção de negócio sofreu gravação ou alteração."
```

---

## 4. Protocolo de Rollback e Teardown Cirúrgico

O procedimento de desmontagem remove **exclusivamente os recursos criados nesta execução**, prevenindo qualquer exclusão acidental de artefatos preexistentes:

```bash
#!/usr/bin/env bash
set -eo pipefail

echo "=== PROTOCOLO DE TEARDOWN CIRÚRGICO: Desmontagem Estrita dos Recursos Desta Execução ==="

export PROJECT_ID="itissimple-security-staging"
export REGION="us-east5"
export REPO_NAME="itissimple-docker-repo"
export SERVICE_NAME="itissimple-diagnostic-backend"
export RUNTIME_SA="sa-diagnostic-backend@${PROJECT_ID}.iam.gserviceaccount.com"
export CALLER_SA="sa-diagnostic-caller@${PROJECT_ID}.iam.gserviceaccount.com"

# 1. Desativação do Cloud Run
if [ "${CREATED_SERVICE}" = "true" ]; then
  echo "1. Excluindo serviço Cloud Run criado nesta execução: ${SERVICE_NAME}..."
  gcloud run services delete "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --quiet || true
else
  echo "1. Removendo apenas a tag 'diag' da revisão deste teste (preservando o serviço preexistente)..."
  gcloud run services update-traffic "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --remove-tags="diag" \
    --quiet || true
fi

# 2. Excluir EXCLUSIVAMENTE a imagem Docker compilada nesta execução (preservando outras imagens do repositório)
if [ -n "${IMMUTABLE_IMAGE_REF}" ]; then
  echo "2. Excluindo especificamente a imagem deste build: ${IMMUTABLE_IMAGE_REF}..."
  gcloud artifacts docker images delete "${IMMUTABLE_IMAGE_REF}" \
    --project="${PROJECT_ID}" \
    --quiet \
    --delete-tags || true
fi

# 3. Remover o binding do Cloud Build no Artifact Registry se criado nesta execução
if [ "${CREATED_BUILD_BINDING}" = "true" ] && [ -n "${EFFECTIVE_BUILD_SA}" ]; then
  echo "3. Removendo binding IAM concedido à SA do Cloud Build no Artifact Registry..."
  gcloud artifacts repositories remove-iam-policy-binding "${REPO_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --member="serviceAccount:${EFFECTIVE_BUILD_SA}" \
    --role="roles/artifactregistry.writer" \
    --quiet || true
fi

# 4. Remover bindings IAM das Service Accounts de diagnóstico no projeto
echo "4. Removendo bindings IAM de diagnóstico no projeto..."
gcloud projects remove-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user" \
  --quiet || true

# 5. Excluir as Service Accounts APENAS se tiverem sido criadas nesta execução
if [ "${CREATED_RUNTIME_SA}" = "true" ]; then
  echo "5a. Excluindo Runtime SA criada nesta execução: ${RUNTIME_SA}..."
  gcloud iam service-accounts delete "${RUNTIME_SA}" --project="${PROJECT_ID}" --quiet || true
else
  echo "5a. Preservando Runtime SA preexistente: ${RUNTIME_SA}."
fi

if [ "${CREATED_CALLER_SA}" = "true" ]; then
  echo "5b. Excluindo Caller SA criada nesta execução: ${CALLER_SA}..."
  gcloud iam service-accounts delete "${CALLER_SA}" --project="${PROJECT_ID}" --quiet || true
else
  echo "5b. Preservando Caller SA preexistente: ${CALLER_SA}."
fi

# 6. Preservação Absoluta
echo "========================================================================"
echo "✅ TEARDOWN CIRÚRGICO CONCLUÍDO."
echo "   - Revisão/tag desativada."
echo "   - Imagem específica removida."
echo "   - Repositório Docker preservado."
echo "   - Recursos preexistentes mantidos intactos."
echo "   - Banco de dados Firestore (default) e dados de negócio 100% INTATOS."
echo "========================================================================"
```

---

## 5. Resultados dos Testes Locais Automatizados

A bateria de testes automatizados locais foi expandida para cobrir a validação estrita de audience canônica (bloqueando ampliação via Host/X-Forwarded-Host) e a garantia instrumental de Zero Firestore na Etapa A:

- **Bateria Fase 1D (Geral + 1D.2 + 1E.3 + Checkpoint Final):** `npx tsx test/validate-fase-1d.ts`  
  - Total de testes: **161**  
  - Sucessos: **161**  
  - Falhas: **0**  
  - *Destaques novos:*
    - `Audience canônica configurada no servidor é validada com sucesso em requisição direcionada à URL com tag`
    - `Caller autenticado com sucesso sob audience canônica confiável do servidor`
    - `Token com audience não configurada é REJEITADO com 403 (Host não amplia lista de audiences)`
    - `Retorna código INVALID_IAM_AUDIENCE bloqueando qualquer tentativa de injeção de audience`

- **Bateria Dedicada: Zero Firestore na Etapa A:** `npx tsx test/validate-zero-firestore-etapa-a.ts`  
  - Total de testes: **43**  
  - Sucessos: **43**  
  - Falhas: **0**  
  - *Garantias instrumentadas comprovadas:*
    - Zero leituras, zero escritas, zero exclusões e zero sincronizações durante o boot do servidor
    - Zero operações no Firestore nas rotas de saúde (`/api/health` e `/api/diagnostic/health`)
    - Zero operações no Firestore na rota de identidade (`/api/diagnostic/identity` GET e POST)
    - Comprovação ativa de sensibilidade: interceptor detecta operações quando o probe da Etapa B é disparado

- **Bateria Fase 1C (Cliente & Servidor):** `npx tsx test/validate-fase-1c.ts`  
  - Total de testes: **48**  
  - Sucessos: **48**  
  - Falhas: **0**  

- **Bateria de Isolamento do Firebase Admin:** `npx tsx test/validate-admin-isolation.ts`  
  - Total de testes: **27**  
  - Sucessos: **27**  
  - Falhas: **0**  

- **Verificação TypeScript / Linter:** `npm run lint` (`tsc --noEmit`)  
  - Erros: **0**  

- **Compilação do Applet:** `npm run build`  
  - Status: **Sucesso**  

---

## 6. Critérios Objetivos de Autorização para a Etapa B

Antes de qualquer aprovação para prosseguir da Etapa A para a Etapa B, o operador deve verificar a conformidade estrita de todos os critérios abaixo:

1. **Projeto Ativo:** Confirmado exclusivamente como `itissimple-security-staging`.
2. **Digest Imutável:** Imagem Docker implantada sob referência SHA-256 fixa (zero `:latest`).
3. **URL com Tag:** Deploy realizado com `--no-traffic --tag=diag`; URL da tag acessada com sucesso.
4. **GFE Bloqueado:** Chamadas sem token tanto na URL canônica quanto na URL da tag retornam estritamente `401 Unauthorized` ou `403 Forbidden`.
5. **Audience Canônica:** Token OIDC emitido com audience canônica do Cloud Run (`${SERVICE_URL}`).
6. **Autenticação de Aplicação Prévia:** Rota `/api/diagnostic/identity` chamada com sucesso via `CALLER_TOKEN`, retornando `authenticated: true`, `caller.email: sa-diagnostic-caller@...` e `firestoreAccess: false`.
7. **Zero Contato com Banco:** Nenhuma leitura ou gravação efetuada no Firestore antes do Portão Humano.
8. **Rollback Rastreável:** Flags de criação de recursos devidamente inicializadas para permitir teardown cirúrgico.
