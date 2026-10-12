# IT'S SIMPLE — FASE 1E.1: Playbook Operacional de Deploy Privado e Homologação OIDC/IAM

**Projeto exclusivo:** `itissimple-security-staging`  
**Escopo:** Procedimento Operacional Definitivo, Playbook de Comandos `gcloud`, Matriz de Autenticação OIDC/IAM, Checklist de Testes e Protocolo de Teardown/Rollback  
**Status Atual:** **PRONTO PARA REVISÃO — NENHUM COMANDO EXECUTADO** (Aguardando autorização explícita do operador).

---

## 1. Diretrizes Fundamentais e Ajustes da Fase 1E.1

A presente revisão (Fase 1E.1) corrige e aprofunda as premissas operacionais da Fase 1E antes de qualquer execução na nuvem:

1. **Imagem Docker e Imutabilidade Matemática:**
   - A imagem gerada pelo Cloud Build deve ser identificada por seu **digest SHA-256** único (`image@sha256:...`) ou por uma tag semântica imutável com timestamp único.
   - O uso da tag mutável `:latest` é **estritamente proibido** no build e no deploy.
   - O Artifact Registry é adotado como padrão oficial, com verificação prévia de existência do repositório Docker (substituindo o antigo Container Registry `gcr.io`).

2. **Diferenciação Estrita de Identidades OIDC / IAM:**
   - **Service Account de Execução (Runtime SA):** `sa-diagnostic-backend` executa o container no Cloud Run e possui apenas `roles/datastore.user` no projeto de staging. Ela **não** é a identidade invocadora.
   - **Service Account Invocadora (Caller SA):** `sa-diagnostic-caller` é a identidade autorizada com `roles/run.invoker` no serviço. Seu token é gerado via **impersonação IAM**, sem qualquer chave JSON física.
   - **Operador Humano:** `adm.itissimple@gmail.com` gera ID Token próprio diretamente via `gcloud auth print-identity-token --audiences="${SERVICE_URL}"`.
   - Todas as identidades invocadoras estão registradas na allowlist estática do middleware Express e exigem `email_verified=true` emitido por `https://accounts.google.com`.

3. **Segregação Rígida de Resultados Esperados:**
   - **Chamadas Anônimas:** Devem ser barradas no Google Front End (GFE) com `HTTP 401 Unauthorized` ou `HTTP 403 Forbidden` sem atingir a aplicação Express.
   - **Chamadas Autenticadas mas Não Autorizadas:** Barradas no GFE (se sem `roles/run.invoker`) ou pelo middleware Express com `HTTP 403 Forbidden` (`code: UNAUTHORIZED_IAM_IDENTITY`).
   - **Chamadas Autorizadas a Rotas de Negócio:** Devem alcançar o Express e retornar invariavelmente `HTTP 404 Not Found` (`diagnosticMode: true`), confirmando o não-registro de rotas de negócio.
   - **Firestore:** O probe grava, lê e apaga exclusivamente um documento efêmero na coleção `_diagnostic_probes`. **Não se exige que coleções de negócio estejam vazias**, exigindo-se apenas que seus dados permaneçam estritamente inalterados.

4. **Realismo Financeiro e Custos de Infraestrutura:**
   - Correção da premissa de "custo zero garantido": embora Cloud Run e Firestore possuam cotas gratuitas mensais generosas, custos mínimos residuais podem incidir sobre o armazenamento do Artifact Registry (~$0.10/GB/mês) e limites de minutos de Cloud Build se a cota do dia estiver comprometida.
   - O playbook inclui procedimentos de **teardown e limpeza de imagens** pós-validação para estancar custos contínuos.

5. **Invariantes de Segurança:**
   - `DIAGNOSTIC_ONLY=true` obrigatório em tempo de build e execução.
   - Proibição absoluta de `--allow-unauthenticated`.
   - Proibição absoluta de referência ou acesso ao projeto legado `itissimple-8663d`.
   - Zero modificações no código ou variáveis de ambiente do frontend.

---

## 2. Desenho Arquitetural da Defesa em Profundidade

```
                              [ REQUISIÇÃO EXTERNA ]
                                        │
                                        ▼
             ┌────────────────────────────────────────────────────────┐
             │            Google Cloud Front End (GFE)                │
             │           (Primeira Linha de Bloqueio IAM)             │
             └──────────────────────────┬─────────────────────────────┘
                                        │
              ┌─────────────────────────┴─────────────────────────┐
              │                                                   │
     [ SEM ID TOKEN OU ANÔNIMO ]                         [ ID TOKEN FORNECIDO ]
              │                                                   │
              ▼                                                   ▼
     BLOQUEADO NO GFE:                                  GFE valida token Google
     HTTP 401 / 403                                     e papel roles/run.invoker
     (Zero tráfego no container)                                  │
                                                    ┌─────────────┴─────────────┐
                                                    │                           │
                                            [ NÃO AUTORIZADO ]           [ AUTORIZADO ]
                                                    │                           │
                                                    ▼                           ▼
                                            BLOQUEADO NO GFE:            Encaminhado ao
                                            HTTP 403 Forbidden             Container
                                            (Zero tráfego)                      │
                                                                                ▼
             ┌──────────────────────────────────────────────────────────────────┴─────┐
             │                     Cloud Run: itissimple-diagnostic-backend           │
             │                     Identidade de Execução (Runtime SA):               │
             │                     sa-diagnostic-backend@...                          │
             │                     Variável: DIAGNOSTIC_ONLY=true                     │
             │                                                                        │
             │  ┌──────────────────────────────────────────────────────────────────┐  │
             │  │ Middleware Express: diagnosticAuthMiddleware (Segunda Linha)     │  │
             │  │ - Rejeita tokens Firebase Auth (securetoken.google.com)          │  │
             │  │ - Valida aud == CLOUD_RUN_SERVICE_URL                            │  │
             │  │ - Valida iss == https://accounts.google.com                      │  │
             │  │ - Valida email_verified == true                                  │  │
             │  │ - Valida se email ∈ EXPLICIT_AUTHORIZED_IAM_IDENTITIES           │  │
             │  └──────────────────────────────────┬───────────────────────────────┘  │
             │                                     │                                  │
             │                ┌────────────────────┴────────────────────┐             │
             │                │                                         │             │
             │      [ ROTA DE NEGÓCIO ]                        [ ROTA DIAGNÓSTICO ]   │
             │    (/api/tutors, /api/auth...)              (/api/diagnostic/firestore)│
             │                │                                         │             │
             │                ▼                                         ▼             │
             │         HTTP 404 Not Found                    Executa Firestore Probe: │
             │         diagnosticMode: true                  - Write (_diagnostic_...)│
             │         (Zero processamento)                  - Read & Verify          │
             │                                               - Delete                 │
             └──────────────────────────────────────────────────────────┼─────────────┘
                                                                        │
                                                                        ▼
                                                   ┌──────────────────────────────────┐
                                                   │ Cloud Firestore: (default)       │
                                                   │ itissimple-security-staging      │
                                                   │ Coleção: _diagnostic_probes      │
                                                   └──────────────────────────────────┘
```

---

## 3. Matriz de Identidades, Permissões e Autenticação OIDC

| Entidade | Tipo | Identificador IAM | Papel IAM no GCP | Papel no Express | Método de Geração de Token |
|---|---|---|---|---|---|
| **Runtime SA** | Service Account | `sa-diagnostic-backend@itissimple-security-staging.iam.gserviceaccount.com` | `roles/datastore.user` (no projeto) | Execução do processo Node.js | Não gera tokens para si mesma; usa ADC para o Firestore Admin SDK |
| **Caller SA** | Service Account | `sa-diagnostic-caller@itissimple-security-staging.iam.gserviceaccount.com` | `roles/run.invoker` (no serviço Cloud Run) | Allowlist Estática (`EXPLICIT_AUTHORIZED_IAM_IDENTITIES`) | Impersonação IAM: `gcloud auth print-identity-token --impersonate-service-account=... --audiences=...` |
| **Operador Humano** | Usuário Google | `adm.itissimple@gmail.com` | `roles/run.invoker` (no serviço Cloud Run) + `roles/iam.serviceAccountTokenCreator` (na Caller SA) | Allowlist Estática (`EXPLICIT_AUTHORIZED_IAM_IDENTITIES`) | Sessão `gcloud`: `gcloud auth print-identity-token --audiences=...` |

### Regras Estritas de Não-Utilização de Chaves Privadas
- **Zero chaves JSON:** Não gerar nem descarregar arquivos de chave de Service Account (`*.json`).
- Toda autenticação de máquina ou de automação deve utilizar credenciais efêmeras baseadas em impersonação de conta de serviço suportada nativamente pelo Google Cloud IAM.

---

## 4. Playbook Operacional de Implantação Passo a Passo

> **IMPORTANTE:** Os comandos abaixo constituem o roteiro auditado e aprovado. **Nenhum destes comandos foi executado automaticamente.**

### Etapa 0: Definição de Variáveis de Sessão e Bloqueio de Projeto

```bash
# 0.1 Configuração de variáveis essenciais da sessão operacional
export PROJECT_ID="itissimple-security-staging"
export REGION="us-east5"
export REPO_NAME="itissimple-docker-repo"
export SERVICE_NAME="itissimple-diagnostic-backend"
export RUNTIME_SA="sa-diagnostic-backend@${PROJECT_ID}.iam.gserviceaccount.com"
export CALLER_SA="sa-diagnostic-caller@${PROJECT_ID}.iam.gserviceaccount.com"
export ADMIN_EMAIL="adm.itissimple@gmail.com"

# 0.2 Bloquear o gcloud estritamente no projeto staging
gcloud config set project "${PROJECT_ID}"

# 0.3 Validar que o projeto ativo NÃO é o legado
CURRENT_PROJECT=$(gcloud config get-value project)
if [ "${CURRENT_PROJECT}" != "itissimple-security-staging" ]; then
  echo "ERRO CRÍTICO: Projeto ativo inválido (${CURRENT_PROJECT})! Abortando imediatamente."
  exit 1
fi
echo "Projeto travado com sucesso: ${CURRENT_PROJECT}"
```

### Etapa 1: Habilitação das APIs Obrigatórias do Google Cloud

```bash
# Habilitar as APIs fundamentais para Cloud Run, Cloud Build, Artifact Registry e Firestore
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  iam.googleapis.com \
  --project="${PROJECT_ID}"
```

### Etapa 2: Configuração do Artifact Registry e Permissões de Build

```bash
# 2.1 Verificar se o repositório Docker já existe no Artifact Registry
REPO_EXISTS=$(gcloud artifacts repositories list \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --filter="name:projects/${PROJECT_ID}/locations/${REGION}/repositories/${REPO_NAME}" \
  --format="value(name)")

if [ -z "${REPO_EXISTS}" ]; then
  echo "Criando repositório Docker no Artifact Registry: ${REPO_NAME}"
  gcloud artifacts repositories create "${REPO_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --repository-format=docker \
    --description="Repositorio Docker oficial do backend de seguranca It is Simple"
else
  echo "Repositorio Docker ja existe: ${REPO_EXISTS}"
fi

# 2.2 Obter número do projeto para conceder permissões à Service Account do Cloud Build
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# 2.3 Garantir que o Cloud Build tem permissão para publicar imagens no Artifact Registry
gcloud artifacts repositories add-iam-policy-binding "${REPO_NAME}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/artifactregistry.writer"
```

### Etapa 3: Criação da Service Account de Execução (Runtime SA)

```bash
# 3.1 Criar a conta de execução dedicada com menor privilégio
gcloud iam service-accounts create sa-diagnostic-backend \
  --project="${PROJECT_ID}" \
  --display-name="Service Account de Execução do Backend Diagnóstico Cloud Run" \
  --description="Identidade restrita com privilégio mínimo para execução do probe de Firestore"

# 3.2 Conceder estritamente roles/datastore.user no projeto de staging
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user"
```

### Etapa 4: Criação da Service Account Invocadora (Caller SA) e Permissões de Impersonação

```bash
# 4.1 Criar a conta de invocação para chamadas autorizadas
gcloud iam service-accounts create sa-diagnostic-caller \
  --project="${PROJECT_ID}" \
  --display-name="Service Account Invocadora de Diagnóstico" \
  --description="Identidade autorizada para chamar o serviço privado de diagnóstico"

# 4.2 Conceder ao operador humano a capacidade de gerar tokens para a Caller SA via impersonação
# (Permite emitir tokens OIDC da SA sem precisar baixar chave JSON)
gcloud iam service-accounts add-iam-policy-binding "${CALLER_SA}" \
  --project="${PROJECT_ID}" \
  --member="user:${ADMIN_EMAIL}" \
  --role="roles/iam.serviceAccountTokenCreator"
```

### Etapa 5: Construção da Imagem Docker e Extração do Digest SHA-256 Imutável

```bash
# 5.1 Definir tag semântica imutável com data/hora e base do repositório
BUILD_TIMESTAMP=$(date +%Y%m%d%H%M%S)
IMAGE_TAG="1e-diagnostic-${BUILD_TIMESTAMP}"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}"
IMAGE_URI="${IMAGE_BASE}:${IMAGE_TAG}"

echo "Construindo imagem imutável: ${IMAGE_URI}"

# 5.2 Submeter build ao Cloud Build
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --tag="${IMAGE_URI}"

# 5.3 Extrair com precisão o digest SHA-256 imutável da imagem construída
IMAGE_DIGEST=$(gcloud artifacts docker images describe "${IMAGE_URI}" \
  --project="${PROJECT_ID}" \
  --format="value(image_summary.digest)")

if [ -z "${IMAGE_DIGEST}" ]; then
  echo "ERRO FATAL: Falha ao obter digest SHA-256 da imagem. Abortando deploy."
  exit 1
fi

# 5.4 Compor a referência exata e imutável para o Cloud Run
IMMUTABLE_IMAGE_REF="${IMAGE_BASE}@${IMAGE_DIGEST}"
echo "Imagem verificada com digest imutável: ${IMMUTABLE_IMAGE_REF}"
```

### Etapa 6: Implantação Inicial do Cloud Run Privado

```bash
# 6.1 Deploy do container apontando para o digest imutável (Sem usar :latest)
gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMMUTABLE_IMAGE_REF}" \
  --service-account="${RUNTIME_SA}" \
  --no-allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=60s \
  --set-env-vars="NODE_ENV=production,DIAGNOSTIC_ONLY=true,FIREBASE_PROJECT_ID=${PROJECT_ID},FIREBASE_DATABASE_ID=(default)"
```

### Etapa 7: Captura da URL Canônica e Injeção de `CLOUD_RUN_SERVICE_URL`

```bash
# 7.1 Capturar a URL HTTPS canônica real atribuída pelo Cloud Run
export SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "URL canônica do serviço Cloud Run: ${SERVICE_URL}"

# 7.2 Atualizar as variáveis de ambiente com a audience esperada pelo verificador de OIDC
gcloud run services update "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --update-env-vars="CLOUD_RUN_SERVICE_URL=${SERVICE_URL}"
```

### Etapa 8: Concessão Estrita de `roles/run.invoker` no Nível de Recurso

```bash
# 8.1 Conceder permissão de invocação estritamente para a Caller SA no serviço
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${CALLER_SA}" \
  --role="roles/run.invoker"

# 8.2 Conceder permissão de invocação para o Administrador Humano no serviço
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="user:${ADMIN_EMAIL}" \
  --role="roles/run.invoker"
```

---

## 5. Protocolo de Testes Pós-Deploy e Validação de Resultados

Após o deploy autorizado, o operador executa rigorosamente os testes em sequência para comprovar cada camada de isolamento.

### Teste 1: Bloqueio Obrigatório de Chamadas Anônimas (Google Front End)

- **Propósito:** Comprovar que o serviço não está exposto à internet pública.
- **Comando:**
  ```bash
  curl -i -X GET "${SERVICE_URL}/api/diagnostic/firestore"
  ```
- **Resultado Esperado:**
  - Código HTTP: `401 Unauthorized` (ou `403 Forbidden`).
  - Emitido diretamente pelo Google Front End (GFE).
  - Corpo da resposta: Página HTML de erro de autenticação do Google.
  - Zero processamento no container Express.

### Teste 2: Rejeição de Identidade Não Autorizada no IAM (GFE)

- **Propósito:** Comprovar que contas Google válidas sem o papel `roles/run.invoker` são bloqueadas antes do Express.
- **Comando:**
  ```bash
  # Gerar token a partir de outra conta Google não autorizada
  curl -i -X GET "${SERVICE_URL}/api/diagnostic/firestore" \
    -H "Authorization: Bearer ${UNAUTHORIZED_ACCOUNT_TOKEN}"
  ```
- **Resultado Esperado:**
  - Código HTTP: `403 Forbidden`.
  - Emitido pelo GFE do Cloud Run antes de encaminhar ao container.

### Teste 3: Rejeição no Middleware Express de Identidade Fora da Allowlist

- **Propósito:** Comprovar a segunda camada de defesa em profundidade. Caso uma identidade receba `roles/run.invoker` no GCP por acidente ou herança de projeto, o Express deve barrá-la por não constar em `EXPLICIT_AUTHORIZED_IAM_IDENTITIES`.
- **Cenário:** Token OIDC emitido por `https://accounts.google.com` com audience igual à URL do Cloud Run, porém com e-mail não cadastrado.
- **Resultado Esperado:**
  - Código HTTP: `403 Forbidden`.
  - Emitido pelo Express em JSON:
    ```json
    {
      "error": "Forbidden",
      "message": "Access denied: Invalid or unauthorized Google Cloud IAM credentials.",
      "code": "UNAUTHORIZED_IAM_IDENTITY"
    }
    ```

### Teste 4: Sucesso do Probe Firestore via Operador Humano Autorizado

- **Propósito:** Validar o ciclo completo autenticado pelo administrador humano (`adm.itissimple@gmail.com`).
- **Comandos:**
  ```bash
  # 4.1 Gerar token de identidade OIDC com a audience correta
  export ADMIN_TOKEN=$(gcloud auth print-identity-token --audiences="${SERVICE_URL}")

  # 4.2 Executar o probe diagnóstico
  curl -s -X GET "${SERVICE_URL}/api/diagnostic/firestore" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .
  ```
- **Resultado Esperado:**
  ```json
  {
    "success": true,
    "diagnosticMode": true,
    "projectId": "itissimple-security-staging",
    "databaseId": "(default)",
    "serviceAccount": "sa-diagnostic-backend@itissimple-security-staging.iam.gserviceaccount.com",
    "serviceAccountSource": "gcp-metadata",
    "collection": "_diagnostic_probes",
    "operations": {
      "write": { "status": "confirmed" },
      "read": { "status": "confirmed", "verified": true },
      "delete": { "status": "confirmed" }
    }
  }
  ```
- **Verificação Crítica:**
  - `projectId` confirmado como `itissimple-security-staging`.
  - `serviceAccount` executora confirmada como `sa-diagnostic-backend`.
  - `serviceAccountSource` confirmada como `gcp-metadata` (metadados oficiais do GCP).
  - Todas as três operações (`write`, `read`, `delete`) com status `confirmed`.

### Teste 5: Sucesso do Probe Firestore via Service Account Invocadora (Impersonação)

- **Propósito:** Validar a invocação máquina-a-máquina utilizando `sa-diagnostic-caller` sem chaves JSON.
- **Comandos:**
  ```bash
  # 5.1 Gerar token de identidade impersonando a Caller SA
  export CALLER_SA_TOKEN=$(gcloud auth print-identity-token \
    --impersonate-service-account="${CALLER_SA}" \
    --audiences="${SERVICE_URL}")

  # 5.2 Executar o probe diagnóstico com o token da Service Account
  curl -s -X GET "${SERVICE_URL}/api/diagnostic/firestore" \
    -H "Authorization: Bearer ${CALLER_SA_TOKEN}" | jq .
  ```
- **Resultado Esperado:** `success: true` idêntico ao Teste 4.

### Teste 6: Indisponibilidade Total de Rotas de Negócio sob Identidade Autorizada

- **Propósito:** Garantir que mesmo com credenciais válidas e autorizadas, as rotas normais da aplicação (tutores, alunos, login) permanecem estritamente inoperantes no modo diagnóstico.
- **Comandos:**
  ```bash
  # 6.1 Tentar rota de tutores
  curl -s -i -X GET "${SERVICE_URL}/api/tutors" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .

  # 6.2 Tentar rota de estudantes
  curl -s -i -X GET "${SERVICE_URL}/api/students" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .

  # 6.3 Tentar rota de autenticação de negócio
  curl -s -i -X POST "${SERVICE_URL}/api/auth/login" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq .
  ```
- **Resultado Esperado:**
  - Código HTTP: `404 Not Found` em todos os endpoints.
  - Corpo da resposta:
    ```json
    {
      "error": "Not Found",
      "message": "Backend is operating in DIAGNOSTIC_ONLY mode. Business routes, authentication, student/tutor management, and payments are strictly not registered.",
      "diagnosticMode": true
    }
    ```

### Teste 7: Auditoria de Integridade e Intocabilidade de Dados no Firestore

- **Propósito:** Garantir que nenhuma coleção de negócio foi criada ou modificada.
- **Regra de Homologação:** Não se exige que coleções de negócio estejam vazias (caso existam dados prévios de homologação), mas comprova-se estritamente que **nenhuma modificação ocorreu fora da coleção `_diagnostic_probes`**.
- **Comando:**
  ```bash
  # Inspecionar operações recentes no Firestore do projeto staging
  gcloud firestore operations list --project="${PROJECT_ID}"
  ```
- **Critério de Aceite:** O documento temporário criado pelo probe em `_diagnostic_probes` foi imediatamente excluído na etapa `delete`. Nenhuma gravação em coleções de tutores, alunos ou usuários.

---

## 6. Auditoria de Custos e Análise de Infraestrutura

### Esclarecimento sobre Custos (Correção Formal da Fase 1E.1)
- **Não há "custo zero absoluto garantido" por contrato no GCP:**
  - **Cloud Run:** Possui cota gratuita mensal (primeiras 2 milhões de requisições, 360.000 GB-segundos de memória e 180.000 vCPU-segundos). Com `min-instances=0`, o custo de execução ociosa é rigorosamente $0.00.
  - **Cloud Firestore:** Possui cota diária gratuita (50.000 leituras, 20.000 gravações e 20.000 exclusões por dia). O probe consome exatamente 1 escrita, 1 leitura e 1 exclusão por execução.
  - **Cloud Build:** Possui cota gratuita diária de 120 minutos de build em instâncias padrão (`e2-medium`).
  - **Artifact Registry (Atenção a Custos Contínuos):** O armazenamento de imagens no Artifact Registry custa aproximadamente **$0.10 por GB/mês**. Uma imagem de container Node.js ocupa ~150-300 MB. Se a imagem permanecer armazenada indefinidamente, gerará uma cobrança residual de alguns centavos por mês.
- **Mitigação:** A execução do procedimento de limpeza (Teardown) pós-validação elimina a imagem armazenada, neutralizando qualquer custo contínuo recorrente.

---

## 7. Procedimento de Teardown e Rollback Pós-Validação

Após a realização e comprovação satisfatória de todos os testes de diagnóstico, o operador pode manter o serviço desescalado para zero instâncias OU executar a desmontagem completa dos recursos temporários de diagnóstico:

```bash
# ==============================================================================
# PROTOCOLO DE TEARDOWN: Desmontagem Limpa dos Recursos de Diagnóstico
# ==============================================================================

# 1. Excluir o serviço Cloud Run de diagnóstico
gcloud run services delete "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --quiet

# 2. Excluir a imagem Docker do Artifact Registry para zerar custos de armazenamento
gcloud artifacts docker images delete "${IMAGE_URI}" \
  --project="${PROJECT_ID}" \
  --quiet

# 3. Remover os bindings IAM do projeto
gcloud projects remove-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/datastore.user" \
  --quiet

# 4. Excluir as Service Accounts temporárias de diagnóstico
gcloud iam service-accounts delete "${RUNTIME_SA}" \
  --project="${PROJECT_ID}" \
  --quiet

gcloud iam service-accounts delete "${CALLER_SA}" \
  --project="${PROJECT_ID}" \
  --quiet

echo "Teardown concluído com sucesso. Todos os recursos de diagnóstico foram removidos."
```

---

## 8. Critérios Formais de Decisão GO / NO-GO

Antes de submeter qualquer comando de implantação, avalie os critérios estritos da tabela abaixo:

| Critério | Tipo | Condição Obrigatória para GO | Ação em caso de NO-GO |
|---|:---:|---|---|
| **Projeto Ativo** | **ELIMINATÓRIO** | `gcloud config get-value project` retorna exatamente `itissimple-security-staging`. | **ABORTAR IMEDIATAMENTE.** Proibição total de qualquer menção a `itissimple-8663d`. |
| **Integridade da Imagem** | **ELIMINATÓRIO** | A imagem foi compilada com tag única no Artifact Registry e seu digest SHA-256 (`image@sha256:...`) foi capturado com sucesso. | **ABORTAR.** Não utilizar `:latest` nem imagens sem digest verificado. |
| **Serviço 100% Privado** | **ELIMINATÓRIO** | Flag `--no-allow-unauthenticated` presente no comando `gcloud run deploy`. | **ABORTAR.** Nunca implantar com `--allow-unauthenticated`. |
| **Variável DIAGNOSTIC_ONLY** | **ELIMINATÓRIO** | Injetada no container como `true` e confirmada no `Dockerfile`. | **ABORTAR.** Risco de carregamento acidental de rotas de negócio. |
| **Identidades Invocadoras** | **ELIMINATÓRIO** | Limitadas estritamente a `adm.itissimple@gmail.com` e `sa-diagnostic-caller`. | **ABORTAR.** Nenhuma conta genérica ou permissão ampla no projeto. |
| **Audience no Cloud Run** | **ELIMINATÓRIO** | `CLOUD_RUN_SERVICE_URL` atualizado com a URL canônica HTTPS real gerada pelo Cloud Run. | **ABORTAR.** Sem audience real, o validador falha fechado. |
| **Zero Chaves JSON** | **ELIMINATÓRIO** | Nenhum comando de criação de chave JSON (`gcloud iam service-accounts keys create`) é executado. | **ABORTAR.** Utilizar apenas ADC e impersonação nativa. |
| **Frontend Preservado** | **ELIMINATÓRIO** | Nenhuma alteração de código ou de variáveis de ambiente no frontend React/Vite. | **ABORTAR.** O frontend permanece desacoplado até a Fase 2. |
| **Autorização Explícita** | **ELIMINATÓRIO** | Operador humano emitiu autorização expressa para iniciar o deploy. | **AGUARDAR.** Nenhum comando no Google Cloud deve ser executado de forma autônoma. |
