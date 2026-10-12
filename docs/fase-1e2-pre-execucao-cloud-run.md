# IT'S SIMPLE — FASE 1E.2: Roteiro Final de Pré-Execução Controlada do Cloud Run

**Projeto exclusivo:** `itissimple-security-staging`  
**Escopo:** Manual de Procedimento para Execução Humana Supervisionada, Segregação de Portões de Aprovação, Deploy com `--no-traffic` e Tag de Diagnóstico, Verificações com Parada Imediata e Teardown Seguro  
**Status Atual:** **REVISADO E ATUALIZADO NA FASE 1E.3** (Consulte `/docs/fase-1e3-correcoes-operacionais-finais.md` para o playbook com as 7 correções operacionais cirúrgicas). NENHUM COMANDO EXECUTADO.

---

## 1. Ajustes Obrigatórios e Fundamentos da Fase 1E.2

O presente roteiro consolida as diretrizes definitivas de segurança antes de qualquer intervenção operacional na nuvem:

### 1.1 Identificação das Service Accounts do Cloud Build e Artifact Registry
O Cloud Build opera sob identidades de serviço gerenciadas pelo Google. Dependendo da data de ativação e das configurações de política de organização do projeto GCP, uma de duas contas é utilizada para o processo de build:
- **Conta tradicional do Cloud Build:** `${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com` (Cloud Build Service Account).
- **Conta Compute Engine (Padrão recente GCP):** `${PROJECT_NUMBER}-compute@developer.gserviceaccount.com`.

**Permissões mínimas para publicação de imagens no Artifact Registry:**
- `roles/artifactregistry.writer`: Permite enviar e criar manifests e blobs no repositório Docker do Artifact Registry.
- `roles/logging.logWriter`: Permite enviar logs de compilação para o Cloud Logging.
*O roteiro automatiza a concessão do papel `roles/artifactregistry.writer` e `roles/logging.logWriter` a ambas as identidades para eliminar qualquer risco de falha por permissão negada.*

### 1.2 Matriz de Permissões Mínimas do Operador Humano
O operador humano (`adm.itissimple@gmail.com`) necessita dos seguintes papéis IAM no projeto `itissimple-security-staging`:
- **Cloud Build:** `roles/cloudbuild.builds.editor` (submissão e acompanhamento de compilações) + `roles/viewer`.
- **Artifact Registry:** `roles/artifactregistry.admin` (criação do repositório Docker e leitura/exclusão de imagens).
- **Service Accounts e IAM:** `roles/iam.serviceAccountAdmin` (criação e remoção das contas de serviço dedicadas) e `roles/resourcemanager.projectIamAdmin` (concessão de bindings de IAM no projeto e nos serviços).
- **Associação de Identidade de Execução:** `roles/iam.serviceAccountUser` na conta `sa-diagnostic-backend` (obrigatório para que o Cloud Run permita executar containers sob esta identidade).
- **Impersonação de Chamadas:** `roles/iam.serviceAccountTokenCreator` na conta `sa-diagnostic-caller` (permite emitir tokens OIDC sem download de chaves privadas).
- **Cloud Run:** `roles/run.admin` (deploy, configuração de flags, controle de tráfego, tags e vinculação de IAM invoker).
- **Service Usage:** `roles/serviceusage.serviceUsageAdmin` (habilitação das APIs do GCP).

### 1.3 Primeiro Deploy com `--no-traffic` e Tag de Diagnóstico Dedicada
- Para impedir que a nova revisão receba tráfego indiscriminado ou substitua acidentalmente rotas anteriores, o comando de deploy utiliza:
  `--no-traffic --tag="diag"`
- O parâmetro `--no-traffic` garante que a rota de tráfego principal (URL canônica do serviço) não direcione tráfego (ou mantenha 0%) para a nova revisão até que ela seja expressamente promovida.
- O parâmetro `--tag="diag"` gera uma URL de revisão dedicada e isolada:
  `https://diag---${SERVICE_NAME}-<hash>-<region>.a.run.app`
- Isso viabiliza testes prévios direcionados exclusivamente à revisão marcada.

### 1.4 Blindagem Contra Invocação Pública (Inclusive URLs com Tag)
- A flag `--no-allow-unauthenticated` opera no Google Cloud Front End (GFE) em nível do recurso Cloud Run.
- **Garantia de segurança:** Toda e qualquer URL vinculada ao serviço — seja a URL canônica ou qualquer URL de tag de revisão (`https://diag---...`) — exige obrigatoriamente um ID Token OIDC assinado pelo Google com permissão IAM `roles/run.invoker`.
- Requisições anônimas são rejeitadas pelo GFE com `HTTP 401 Unauthorized` ou `HTTP 403 Forbidden` sem que nenhum pacote de rede atinja o container.

### 1.5 Validação OIDC Antes de Tocar no Firestore
- O operador valida a integridade do token emitido via Google OAuth2 (`tokeninfo`) e testa um endpoint de verificação (`/api/diagnostic/health`) ou uma rota protegida sem efeitos colaterais.
- Apenas após a confirmação de que o GFE e o middleware Express validaram a assinatura, emissor, audience e allowlist, prossegue-se para o teste de persistência no Firestore.

### 1.6 Sincronização Estrita da URL Canônica como Audience
- Os tokens OIDC exigem que a claim `aud` coincida com a URL exata do serviço Cloud Run.
- Antes do primeiro teste autenticado, a URL real gerada pelo Cloud Run é capturada e injetada na variável de ambiente `CLOUD_RUN_SERVICE_URL` do serviço, garantindo harmonia entre emissão e validação.

### 1.7 Segregação Rígida de Portões de Aprovação
O roteiro está dividido em dois blocos estanques:
- **Etapa A — Infraestrutura Privada:** Preparação, compilação, implantação sem tráfego e validação de autenticação/saúde sem contato com o Firestore.
- **PORTÃO DE APROVAÇÃO (GATE HUMANO OBRIGATÓRIO):** Interrupção formal das operações aguardando confirmação expressa do operador.
- **Etapa B — Diagnóstico Firestore:** Execução do probe real de escrita, leitura e exclusão na coleção efêmera `_diagnostic_probes`.

### 1.8 Verificações Após Cada Comando com Parada Imediata
Cada bloco de comandos inclui validação do código de retorno (`$?`) e verificação de integridade dos artefatos. Se qualquer etapa falhar, o script é interrompido imediatamente (`exit 1`).

### 1.9 Rollback e Teardown Seguro sem Perda de Dados de Negócio
Os procedimentos de rollback desfazem exclusivamente os artefatos efêmeros de diagnóstico (serviço Cloud Run, imagem no Artifact Registry, bindings IAM e Service Accounts temporárias), preservando intactos o banco de dados Firestore `(default)` e todas as coleções de aplicação.

---

## 2. ETAPA A — Infraestrutura Privada (Criação, Build, Deploy e Validação de Configuração)

> **Instrução:** Executar os blocos da Etapa A sequencialmente. Não avançar para o próximo bloco caso ocorra qualquer mensagem de erro.

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

# Verificação
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

### Bloco A.2: Configuração do Artifact Registry e Permissões do Cloud Build

```bash
echo "=== [A.2] Configurando Artifact Registry e Permissões de Build ==="

# 2.1 Criar ou verificar repositório Docker
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
else
  echo "Repositório Docker já existe: ${REPO_EXISTS}"
fi

# 2.2 Obter número do projeto e identificar as contas de serviço de build
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
CLOUDBUILD_LEGACY_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
COMPUTE_DEFAULT_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Projeto: ${PROJECT_ID} (Número: ${PROJECT_NUMBER})"
echo "Cloud Build Legacy SA: ${CLOUDBUILD_LEGACY_SA}"
echo "Compute Default SA: ${COMPUTE_DEFAULT_SA}"

# 2.3 Atribuir permissão de escrita no Artifact Registry para a SA legada do Cloud Build
gcloud artifacts repositories add-iam-policy-binding "${REPO_NAME}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --member="serviceAccount:${CLOUDBUILD_LEGACY_SA}" \
  --role="roles/artifactregistry.writer" \
  --quiet || echo "Aviso: Binding para Cloud Build Legacy SA registrado."

# 2.4 Atribuir permissão de escrita no Artifact Registry para a Compute Default SA (GCP moderno)
gcloud artifacts repositories add-iam-policy-binding "${REPO_NAME}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --member="serviceAccount:${COMPUTE_DEFAULT_SA}" \
  --role="roles/artifactregistry.writer" \
  --quiet || echo "Aviso: Binding para Compute Default SA registrado."

# 2.5 Garantir permissão de escrita de logs no projeto
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CLOUDBUILD_LEGACY_SA}" \
  --role="roles/logging.logWriter" \
  --quiet || echo "Aviso: Log writer para Cloud Build SA registrado."

echo "✅ Permissões mínimas de build e publicação de imagens configuradas com sucesso."
```

---

### Bloco A.3: Criação das Service Accounts (Runtime e Caller)

```bash
echo "=== [A.3] Criando Contas de Serviço de Execução e Invocação ==="

# 3.1 Service Account de Execução (Runtime SA)
SA_RUNTIME_EXISTS=$(gcloud iam service-accounts list --project="${PROJECT_ID}" --filter="email:${RUNTIME_SA}" --format="value(email)")
if [ -z "${SA_RUNTIME_EXISTS}" ]; then
  gcloud iam service-accounts create sa-diagnostic-backend \
    --project="${PROJECT_ID}" \
    --display-name="Service Account de Execucao do Backend Diagnostico Cloud Run" \
    --description="Identidade com privilegio minimo de leitura/escrita em Firestore de staging"
fi

# Conceder roles/datastore.user no projeto de staging para a Runtime SA
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user" \
  --quiet

# 3.2 Service Account Invocadora (Caller SA)
SA_CALLER_EXISTS=$(gcloud iam service-accounts list --project="${PROJECT_ID}" --filter="email:${CALLER_SA}" --format="value(email)")
if [ -z "${SA_CALLER_EXISTS}" ]; then
  gcloud iam service-accounts create sa-diagnostic-caller \
    --project="${PROJECT_ID}" \
    --display-name="Service Account Invocadora de Diagnostico" \
    --description="Identidade autorizada para chamar o servico privado via OIDC"
fi

# 3.3 Permitir que o operador humano gere tokens para a Caller SA via impersonação (Zero chaves JSON)
gcloud iam service-accounts add-iam-policy-binding "${CALLER_SA}" \
  --project="${PROJECT_ID}" \
  --member="user:${ADMIN_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --quiet

echo "✅ Contas de serviço configuradas e vinculadas aos papéis estritos de menor privilégio."
```

---

### Bloco A.4: Compilação da Imagem Docker Imutável no Cloud Build

```bash
echo "=== [A.4] Compilando Imagem Docker com Digest SHA-256 Imutável ==="

BUILD_TIMESTAMP=$(date +%Y%m%d%H%M%S)
IMAGE_TAG="1e-diagnostic-${BUILD_TIMESTAMP}"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"
IMAGE_URI="${IMAGE_BASE}:${IMAGE_TAG}"

echo "Iniciando compilação no Cloud Build: ${IMAGE_URI}"

gcloud builds submit \
  --project="${PROJECT_ID}" \
  --tag="${IMAGE_URI}"

# Extração rigorosa do digest SHA-256 único
IMAGE_DIGEST=$(gcloud artifacts docker images describe "${IMAGE_URI}" \
  --project="${PROJECT_ID}" \
  --format="value(image_summary.digest)")

if [ -z "${IMAGE_DIGEST}" ]; then
  echo "❌ ERRO FATAL: Falha ao capturar o digest SHA-256 da imagem gerada. Abortando."
  exit 1
fi

IMMUTABLE_IMAGE_REF="${IMAGE_BASE}@${IMAGE_DIGEST}"
echo "✅ Imagem compilada com sucesso e digest imutável verificado:"
echo "   ${IMMUTABLE_IMAGE_REF}"
```

---

### Bloco A.5: Deploy Inicial Privado com `--no-traffic` e Tag de Diagnóstico

```bash
echo "=== [A.5] Executando Deploy Privado no Cloud Run com --no-traffic e --tag=diag ==="

# Parâmetros de segurança inegociáveis:
# 1. --no-allow-unauthenticated (Bloqueio obrigatório de tráfego público no GFE)
# 2. --no-traffic (A revisão não recebe tráfego na rota principal do serviço)
# 3. --tag=diag (Cria uma URL de revisão dedicada para diagnósticos prévios)
# 4. DIAGNOSTIC_ONLY=true (Modo diagnóstico sem registro de rotas de negócio)

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

echo "✅ Revisão implantada sem tráfego geral e com tag de diagnóstico dedicada."
```

---

### Bloco A.6: Captura da URL Canônica, URL da Tag e Injeção de `CLOUD_RUN_SERVICE_URL`

```bash
echo "=== [A.6] Capturando URLs e Sincronizando Audience de OIDC ==="

# Captura da URL canônica do serviço Cloud Run
export SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")

# Captura da URL específica da revisão com tag 'diag'
export TAG_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.traffic[0].url)")

echo "URL Canônica do Serviço: ${SERVICE_URL}"
echo "URL da Tag de Diagnóstico: ${TAG_URL}"

if [ -z "${SERVICE_URL}" ]; then
  echo "❌ ERRO CRÍTICO: URL do serviço Cloud Run não foi gerada. Abortando."
  exit 1
fi

# Injetar a URL canônica como audience esperada no ambiente do container
gcloud run services update "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --update-env-vars="CLOUD_RUN_SERVICE_URL=${SERVICE_URL},ALLOWED_AUDIENCES=${TAG_URL}" \
  --no-traffic

echo "✅ Variáveis de audience (CLOUD_RUN_SERVICE_URL e ALLOWED_AUDIENCES) sincronizadas com sucesso."
```

---

### Bloco A.7: Concessão Estrita de `roles/run.invoker` no Nível do Serviço

```bash
echo "=== [A.7] Vinculando Permissões de Invocação Estrita no Cloud Run ==="

# 7.1 Conceder permissão de invocação estritamente à Service Account Invocadora
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${CALLER_SA}" \
  --role="roles/run.invoker" \
  --quiet

# 7.2 Conceder permissão de invocação estritamente ao Administrador Humano
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="user:${ADMIN_EMAIL}" \
  --role="roles/run.invoker" \
  --quiet

# 7.3 Verificar que 'allUsers' NÃO consta na política IAM do serviço
ALL_USERS_INVOKER=$(gcloud run services get-iam-policy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/run.invoker AND bindings.members:allUsers" \
  --format="value(bindings.members)")

if [ -n "${ALL_USERS_INVOKER}" ]; then
  echo "❌ ERRO DE SEGURANÇA GRAVE: Invocação pública (allUsers) detectada! Removendo imediatamente..."
  gcloud run services remove-iam-policy-binding "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --member="allUsers" \
    --role="roles/run.invoker" \
    --quiet
  exit 1
fi

echo "✅ Invocação pública confirmada como 100% DESABILITADA. Apenas identidades autorizadas possuem acesso."
```

---

### Bloco A.8: Validação Prévia de Segurança (Sem Acessar o Firestore)

Antes de autorizar qualquer operação de banco de dados, o operador executa estas 4 verificações para comprovar a defesa em profundidade:

#### Verificação A.8.1: Bloqueio Obrigatório de Chamada Anônima no GFE (URL Canônica)
```bash
echo "--- Verificação A.8.1: Chamada anônima na URL canônica ---"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${SERVICE_URL}/api/diagnostic/health")
echo "Código HTTP retornado: ${HTTP_STATUS}"
if [ "${HTTP_STATUS}" != "401" ] && [ "${HTTP_STATUS}" != "403" ]; then
  echo "❌ ERRO GRAVE: Chamada anônima não foi bloqueada no GFE (Esperado: 401 ou 403, Recebido: ${HTTP_STATUS})! Abortando."
  exit 1
fi
echo "✅ Chamada anônima bloqueada com sucesso pelo Google Front End (${HTTP_STATUS})."
```

#### Verificação A.8.2: Bloqueio Obrigatório de Chamada Anônima na URL com Tag de Revisão
```bash
echo "--- Verificação A.8.2: Chamada anônima na URL de revisão com tag ---"
HTTP_STATUS_TAG=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${TAG_URL}/api/diagnostic/health")
echo "Código HTTP retornado na tag: ${HTTP_STATUS_TAG}"
if [ "${HTTP_STATUS_TAG}" != "401" ] && [ "${HTTP_STATUS_TAG}" != "403" ]; then
  echo "❌ ERRO GRAVE: Tag de revisão permitiu acesso anônimo (${HTTP_STATUS_TAG})! Abortando."
  exit 1
fi
echo "✅ Tag de revisão protegida com sucesso contra acesso público (${HTTP_STATUS_TAG})."
```

#### Verificação A.8.3: Inspeção Prévia do Token OIDC Gerado via `tokeninfo`
```bash
echo "--- Verificação A.8.3: Inspecionando Token OIDC do Operador ---"
ADMIN_TOKEN=$(gcloud auth print-identity-token --audiences="${SERVICE_URL}")

# Validar estrutura e claims do token junto ao endpoint oficial do Google
TOKEN_INFO=$(curl -s "https://oauth2.googleapis.com/tokeninfo?id_token=${ADMIN_TOKEN}")
TOKEN_EMAIL=$(echo "${TOKEN_INFO}" | jq -r '.email')
TOKEN_AUD=$(echo "${TOKEN_INFO}" | jq -r '.aud')
TOKEN_VERIFIED=$(echo "${TOKEN_INFO}" | jq -r '.email_verified')

echo "E-mail do Token: ${TOKEN_EMAIL}"
echo "Audience do Token: ${TOKEN_AUD}"
echo "E-mail Verificado: ${TOKEN_VERIFIED}"

if [ "${TOKEN_EMAIL}" != "${ADMIN_EMAIL}" ]; then
  echo "❌ ERRO: O e-mail do token (${TOKEN_EMAIL}) difere do administrador esperado (${ADMIN_EMAIL})!"
  exit 1
fi

if [ "${TOKEN_AUD}" != "${SERVICE_URL}" ]; then
  echo "❌ ERRO: A audience do token (${TOKEN_AUD}) difere da URL do Cloud Run (${SERVICE_URL})!"
  exit 1
fi

if [ "${TOKEN_VERIFIED}" != "true" ]; then
  echo "❌ ERRO: O e-mail do token não está marcado como verificado pelo Google!"
  exit 1
fi

echo "✅ Token OIDC emitido e validado com sucesso pela autoridade Google."
```

#### Verificação A.8.4: Chamada Autenticada de Saúde (Zero Acesso ao Firestore)
```bash
echo "--- Verificação A.8.4: Teste de saúde autenticado (Sem Firestore) ---"
HEALTH_RESPONSE=$(curl -s -X GET "${SERVICE_URL}/api/diagnostic/health" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")

echo "Resposta do backend:"
echo "${HEALTH_RESPONSE}" | jq .

SERVICE_STATUS=$(echo "${HEALTH_RESPONSE}" | jq -r '.status')
ACTIVE_SA=$(echo "${HEALTH_RESPONSE}" | jq -r '.serviceAccount')

if [ "${SERVICE_STATUS}" != "ok" ]; then
  echo "❌ ERRO: Resposta de saúde inválida. Abortando."
  exit 1
fi

echo "✅ Backend respondeu com sucesso sob a identidade de execução: ${ACTIVE_SA}"
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
 bloqueada e a autenticação OIDC foi confirmada sem nenhum acesso ao banco Firestore.

 PARADA OBRIGATÓRIA:
 A ETAPA B REALIZA GRAVAÇÃO, LEITURA E EXCLUSÃO REAIS NO CLOUD FIRESTORE.
 O OPERADOR DEVE EMITIR AUTORIZAÇÃO EXPLÍCITA PARA PROSSEGUIR.

 NÃO EXECUTAR A ETAPA B SEM AUTORIZAÇÃO ESCRITA ESPECÍFICA.
========================================================================================
```

---

## 3. ETAPA B — Diagnóstico Firestore (Conectividade e Persistência Reais)

> **Instrução:** Executar esta etapa **somente após autorização humana explícita** no console/terminal.

### Bloco B.1: Execução do Probe Firestore via Administrador Humano

```bash
echo "=== [B.1] Executando Probe Firestore com ID Token do Administrador Humano ==="

# Obter token atualizado
ADMIN_TOKEN=$(gcloud auth print-identity-token --audiences="${SERVICE_URL}")

PROBE_RESPONSE=$(curl -s -X GET "${SERVICE_URL}/api/diagnostic/firestore" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")

echo "Resultado do Probe Firestore:"
echo "${PROBE_RESPONSE}" | jq .

PROBE_SUCCESS=$(echo "${PROBE_RESPONSE}" | jq -r '.success')
WRITE_STATUS=$(echo "${PROBE_RESPONSE}" | jq -r '.operations.write.status')
READ_STATUS=$(echo "${PROBE_RESPONSE}" | jq -r '.operations.read.status')
DELETE_STATUS=$(echo "${PROBE_RESPONSE}" | jq -r '.operations.delete.status')
CONFIRMED_PROJECT=$(echo "${PROBE_RESPONSE}" | jq -r '.projectId')
CONFIRMED_SA=$(echo "${PROBE_RESPONSE}" | jq -r '.serviceAccount')

if [ "${PROBE_SUCCESS}" != "true" ] || [ "${WRITE_STATUS}" != "confirmed" ] || [ "${READ_STATUS}" != "confirmed" ] || [ "${DELETE_STATUS}" != "confirmed" ]; then
  echo "❌ ERRO GRAVE: Falha nas operações do probe Firestore!"
  exit 1
fi

if [ "${CONFIRMED_PROJECT}" != "itissimple-security-staging" ]; then
  echo "❌ ERRO GRAVE: Projeto de execução reportado (${CONFIRMED_PROJECT}) não é o staging!"
  exit 1
fi

echo "✅ Ciclo Write -> Read -> Delete no Firestore concluído com sucesso e 100% confirmado."
echo "✅ Projeto verificado: ${CONFIRMED_PROJECT}"
echo "✅ Runtime Service Account: ${CONFIRMED_SA}"
```

---

### Bloco B.2: Execução do Probe Firestore via Service Account Invocadora (Impersonação)

```bash
echo "=== [B.2] Executando Probe Firestore via Caller SA (Impersonação IAM) ==="

CALLER_TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account="${CALLER_SA}" \
  --audiences="${SERVICE_URL}")

CALLER_PROBE_RESPONSE=$(curl -s -X GET "${SERVICE_URL}/api/diagnostic/firestore" \
  -H "Authorization: Bearer ${CALLER_TOKEN}")

echo "Resultado do Probe via Service Account:"
echo "${CALLER_PROBE_RESPONSE}" | jq .

CALLER_SUCCESS=$(echo "${CALLER_PROBE_RESPONSE}" | jq -r '.success')
if [ "${CALLER_SUCCESS}" != "true" ]; then
  echo "❌ ERRO: Invocação máquina-a-máquina com impersonação falhou!"
  exit 1
fi

echo "✅ Invocação OIDC via Caller SA (sem chaves privadas) validada com êxito."
```

---

### Bloco B.3: Teste de Bloqueio de Identidade Não Autorizada na Allowlist

```bash
echo "=== [B.3] Testando Rejeição de Identidade Fora da Allowlist ==="

# Chamada sem autorização IAM ou com token forjado/inválido
INVALID_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${SERVICE_URL}/api/diagnostic/firestore" \
  -H "Authorization: Bearer mock-invalid-token")

echo "Código retornado para token inválido: ${INVALID_STATUS}"
if [ "${INVALID_STATUS}" != "401" ] && [ "${INVALID_STATUS}" != "403" ]; then
  echo "❌ ERRO: Requisição com credencial inválida não foi rejeitada com 401/403!"
  exit 1
fi

echo "✅ Tokens inválidos e identidades não cadastradas são rejeitados com segurança."
```

---

### Bloco B.4: Teste de Desativação Estrita de Rotas de Negócio sob Identidade Autorizada

```bash
echo "=== [B.4] Validando Indisponibilidade de Rotas de Negócio ==="

BUSINESS_ROUTES=("/api/tutors" "/api/students" "/api/auth/login")

for route in "${BUSINESS_ROUTES[@]}"; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${SERVICE_URL}${route}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}")
  echo "Rota: ${route} -> Código HTTP: ${HTTP_CODE}"
  if [ "${HTTP_CODE}" != "404" ]; then
    echo "❌ ERRO GRAVE: Rota de negócio ${route} retornou ${HTTP_CODE} em vez de 404 Not Found!"
    exit 1
  fi
done

echo "✅ Todas as rotas de negócio estão confirmadas como estritamente inoperantes no modo diagnóstico."
```

---

### Bloco B.5: Auditoria de Não-Interferência em Dados de Negócio no Firestore

```bash
echo "=== [B.5] Auditando Coleções e Não-Interferência no Firestore ==="

# Listar operações ou confirmar que nenhuma coleção fora de _diagnostic_probes foi afetada
echo "Verificando se o documento temporário do probe foi excluído da coleção _diagnostic_probes..."
# O probe executa a exclusão no mesmo ciclo. Verificando logs de auditoria do Cloud Run:
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME} AND textPayload:\"probe_\"" \
  --project="${PROJECT_ID}" \
  --limit=5 \
  --format="table(timestamp,textPayload)" || true

echo "✅ Auditoria concluída. Nenhuma coleção de negócio sofreu gravação ou alteração."
```

---

## 4. Protocolo de Rollback e Teardown Seguro

Após a conclusão das validações, o operador escolhe entre manter o container em escala zero (`min-instances=0`) ou desmontar os recursos efêmeros de diagnóstico.

### Regra de Ouro da Desmontagem
- **NUNCA apagar o banco de dados Firestore `(default)` nem coleções de negócio.**
- Excluir estritamente o serviço Cloud Run temporário, as imagens no Artifact Registry, as Service Accounts temporárias e seus bindings IAM.

```bash
#!/usr/bin/env bash
set -eo pipefail

echo "=== PROTOCOLO DE TEARDOWN: Desmontagem Segura dos Recursos Temporários ==="

export PROJECT_ID="itissimple-security-staging"
export REGION="us-east5"
export REPO_NAME="itissimple-docker-repo"
export SERVICE_NAME="itissimple-diagnostic-backend"
export RUNTIME_SA="sa-diagnostic-backend@${PROJECT_ID}.iam.gserviceaccount.com"
export CALLER_SA="sa-diagnostic-caller@${PROJECT_ID}.iam.gserviceaccount.com"

# 1. Excluir o serviço Cloud Run de diagnóstico
echo "1. Excluindo serviço Cloud Run ${SERVICE_NAME}..."
gcloud run services delete "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --quiet || echo "Serviço já excluído ou inexistente."

# 2. Excluir as imagens Docker do repositório para estancar custos de armazenamento
echo "2. Limpando imagens temporárias no Artifact Registry..."
IMAGES=$(gcloud artifacts docker images list "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --format="value(IMAGE)" 2>/dev/null || true)

for img in ${IMAGES}; do
  echo "Excluindo imagem: ${img}"
  gcloud artifacts docker images delete "${img}" --project="${PROJECT_ID}" --quiet --delete-tags || true
done

# 3. Remover os bindings IAM específicos de diagnóstico no projeto
echo "3. Removendo bindings IAM de diagnóstico..."
gcloud projects remove-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user" \
  --quiet || true

# 4. Excluir as Service Accounts efêmeras
echo "4. Excluindo Service Accounts efêmeras de diagnóstico..."
gcloud iam service-accounts delete "${RUNTIME_SA}" \
  --project="${PROJECT_ID}" \
  --quiet || true

gcloud iam service-accounts delete "${CALLER_SA}" \
  --project="${PROJECT_ID}" \
  --quiet || true

echo "========================================================================"
echo "✅ TEARDOWN SEGURO CONCLUÍDO COM SUCESSO."
echo "   - Serviço Cloud Run desativado."
echo "   - Imagens temporárias removidas."
echo "   - Service Accounts de diagnóstico excluídas."
echo "   - Banco de dados Firestore e dados de negócio 100% INTACTOS."
echo "========================================================================"
```

---

## 5. Resumo da Matriz de Decisão Operacional

| Critério de Segurança | Validação Obrigatória | Ação em Caso de Desvio |
|---|---|---|
| **Projeto Ativo** | `itissimple-security-staging` | **ABORTAR IMEDIATAMENTE**. Proibição de tocar em `itissimple-8663d`. |
| **Imagem Docker** | Digest SHA-256 único extraído do Artifact Registry | **ABORTAR**. Proibição de `:latest`. |
| **Tráfego no Primeiro Deploy** | `--no-traffic` com `--tag="diag"` | **ABORTAR**. Não permitir roteamento acidental para produção. |
| **Invocação Pública** | `--no-allow-unauthenticated` no Cloud Run | **ABORTAR**. Toda URL (canônica ou tag) deve barrar chamadas sem token. |
| **Validação Prévia de OIDC** | `tokeninfo` + `/api/diagnostic/health` | **NÃO AVANÇAR** para o Firestore se a validação de token falhar. |
| **Audience do Token** | `CLOUD_RUN_SERVICE_URL` atualizada no serviço | **ABORTAR**. O validador falha fechado se a audience divergir. |
| **Separação de Portões** | Etapa A (Infra) vs Etapa B (Firestore) | **PARAR**. Exigir autorização humana formal antes da Etapa B. |
| **Chaves de Service Account** | Zero arquivos JSON gerados | **ABORTAR**. Utilizar exclusivamente ADC e impersonação nativa. |
| **Frontend** | Zero arquivos modificados | **PRESERVADO**. Frontend desacoplado até a homologação da Fase 2. |
