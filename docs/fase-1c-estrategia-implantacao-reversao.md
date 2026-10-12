# Estratégia de Implantação e Reversão (Deploy & Rollback) — Fase 1C

**Projeto Exclusivo:** `itissimple-security-staging`  
**Destino do Backend:** Google Cloud Run (Serviço Dedicado)  
**Status Atual:** Preparação de código e artefatos concluída. Aguardando aprovação explícita antes da execução de comandos de infraestrutura.  

---

## 1. Criação Futura da Service Account Exclusiva

Para garantir o princípio do menor privilégio e isolamento de identidade, o backend Express executará sob uma Service Account dedicada, sem compartilhamento com o ambiente legado:

- **Nome de Identificação da Conta:** `itissimple-backend-sa`
- **E-mail Canônico:**  
  `itissimple-backend-sa@itissimple-security-staging.iam.gserviceaccount.com`
- **Mecanismo de Autenticação:**  
  **Application Default Credentials (ADC)** nativo do Google Cloud. **Nenhuma chave privada JSON será gerada ou baixada**.

---

## 2. Permissões IAM Mínimas Recomendadas

A Service Account exclusiva deverá receber estritamente os papéis necessários para a operação do backend:

| Papel IAM | Nome Canônico | Finalidade Específica |
| :--- | :--- | :--- |
| **Cloud Datastore User** | `roles/datastore.user` | Leitura e gravação exclusiva nos documentos e coleções do Cloud Firestore do projeto staging. |
| **Firebase Authentication Admin** | `roles/firebaseauth.admin` | Verificação de Firebase ID Tokens no backend e sincronização autorizada de custom claims (`role=admin`). |
| **Secret Manager Secret Accessor** | `roles/secretmanager.secretAccessor` | Leitura dos segredos necessários em tempo de execução (`GEMINI_API_KEY`). |
| **Logs Writer** | `roles/logging.logWriter` | Emissão de logs estruturados de auditoria e telemetria para o Cloud Logging. |

> ⚠️ **Restrição Obrigatória:** Não conceder papéis abrangentes como `roles/editor`, `roles/owner` ou `roles/firebase.admin`.

---

## 3. Configuração de Segredos no Google Secret Manager

Nenhum segredo de API ou credencial deve constar no `Dockerfile` ou em variáveis de ambiente em texto aberto.

Os seguintes segredos deverão ser criados no projeto `itissimple-security-staging`:

1. `gemini-api-key`:
   - Valor: Chave de API autorizada do Google Gemini.
   - Montagem no Cloud Run: Como variável de ambiente `GEMINI_API_KEY` vinculada à versão mais recente do segredo (`:latest`).
2. `allowed-cors-origins` (opcional):
   - Valor: Origens adicionais personalizadas, caso necessário.

---

## 4. Deploy Inicial do Cloud Run (Canary / Zero Tráfego Real)

Para garantir segurança absoluta e validação sem risco de indisponibilidade para os usuários:

### Passo 4.1: Construção e Envio da Imagem (Google Cloud Build)
A imagem será construída a partir do `Dockerfile` dedicado criado nesta fase:
```bash
# Comando de exemplo para a próxima fase (NÃO EXECUTAR AGORA):
gcloud builds submit \
  --tag gcr.io/itissimple-security-staging/itissimple-backend:v1-staging \
  --project=itissimple-security-staging
```

### Passo 4.2: Deploy do Serviço com `--no-traffic`
O serviço Cloud Run será implantado sem receber tráfego público principal:
```bash
# Comando de exemplo para a próxima fase (NÃO EXECUTAR AGORA):
gcloud run deploy itissimple-backend \
  --image gcr.io/itissimple-security-staging/itissimple-backend:v1-staging \
  --region=us-central1 \
  --project=itissimple-security-staging \
  --service-account=itissimple-backend-sa@itissimple-security-staging.iam.gserviceaccount.com \
  --set-env-vars=NODE_ENV=production,STANDALONE_BACKEND=true,FIREBASE_PROJECT_ID=itissimple-security-staging,FIREBASE_DATABASE_ID=\(default\) \
  --set-secrets=GEMINI_API_KEY=gemini-api-key:latest \
  --tag=staging-check \
  --no-traffic
```

---

## 5. Testes de Conectividade Pós-Deploy (Sem Tráfego de Usuários)

Com a revisão implantada sob a tag de teste (ex.: `https://staging-check---itissimple-backend-xxxx-uc.a.run.app`):

1. **Teste 1 — Health Check:**
   ```bash
   curl -i https://staging-check---itissimple-backend-xxxx-uc.a.run.app/api/health
   # Resposta esperada: HTTP 200 OK com status "ok"
   ```
2. **Teste 2 — Status do Serviço Dedicado:**
   ```bash
   curl -i https://staging-check---itissimple-backend-xxxx-uc.a.run.app/
   # Resposta esperada: HTTP 200 OK com JSON contendo service: "It's Simple Dedicated Backend API", status: "online"
   ```
3. **Teste 3 — Auditoria CORS:**
   ```bash
   curl -i -H "Origin: https://malicious-site.example.com" -X OPTIONS https://staging-check---itissimple-backend-xxxx-uc.a.run.app/api/tutors
   # Resposta esperada: HTTP 403 Forbidden
   ```
4. **Teste 4 — Conectividade Firestore e Auth via Token Válido:**
   ```bash
   curl -i -H "Authorization: Bearer <valid-staging-id-token>" https://staging-check---itissimple-backend-xxxx-uc.a.run.app/api/auth/verify-session
   # Resposta esperada: HTTP 200 OK com authenticated: true, uid, e role
   ```

---

## 6. Chaveamento Controlado do Frontend

Após confirmação dos testes da seção 5:

1. **Configuração da URL Base:**
   No frontend React, definir a variável de ambiente:
   ```env
   VITE_BACKEND_API_URL=https://itissimple-backend-xxxx-uc.a.run.app
   ```
2. **Migração Gradual de Tráfego no Cloud Run:**
   Migrar percentual de tráfego progressivamente:
   - 10% de tráfego inicial.
   - Monitoramento de erros 5xx no Cloud Logging por 30 minutos.
   - 100% de tráfego após validação de estabilidade.

---

## 7. Procedimento de Rollback Seguro (Sem Persistência Local)

Em caso de qualquer anomalia no backend ou problemas de conectividade com serviços externos:

### Regra de Ouro do Rollback:
> **NUNCA retornar a arquivos JSON em disco ou mecanismos de persistência local como fallback.** O Cloud Firestore permanece como fonte única da verdade tanto no frontend quanto no backend.

### Passos de Rollback:
1. **Reversão Imediata de Tráfego no Cloud Run:**
   Caso a revisão recente apresente falhas, reverter o tráfego instantaneamente para a revisão anterior estável (tempo de execução: < 5 segundos):
   ```bash
   # Reversão instantânea para revisão estável anterior:
   gcloud run services update-traffic itissimple-backend \
     --to-revisions=PREVIOUS_STABLE_REVISION=100 \
     --project=itissimple-security-staging \
     --region=us-central1
   ```
2. **Reversão no Frontend (se aplicável):**
   - Caso o backend precise de manutenção emergencial, o frontend pode ser reconfigurado para a versão unificada ou modo de espera, mantendo as leituras diretas autorizadas do Firestore via Web SDK para visualização de dados.
3. **Preservação de Integridade:**
   - Nenhum dado é migrado ou excluído durante o procedimento de rollback.
