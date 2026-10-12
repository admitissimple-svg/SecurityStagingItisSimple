# IT'S SIMPLE — FASE 1D.2: Validação Final de Identidade OIDC

**Projeto Exclusivo:** `itissimple-security-staging`  
**Escopo:** Validação criptográfica de Audience, Eliminação Total de Curingas, Allowlist Explícita de Identidades, Anti-Confusão com Firebase Auth e Testes Negativos  
**Status:** Validação e baterias de testes 100% concluídas. **Nenhum deploy realizado, nenhuma infraestrutura ou permissão IAM concedida.**

---

## 1. Verificações e Correções Realizadas (FASE 1D.2)

### 1.1 Validação Criptográfica do Campo Audience (`aud`)
- **Problema anterior:** A validação do token com `googleAuthClient.verifyIdToken` aceitava `undefined` caso as variáveis de URL não estivessem definidas, o que no SDK da Google omitia a verificação do destinatário e permitia que qualquer token do Google emitido para outra finalidade fosse potencialmente aceito.
- **Correção implementada:**
  - A função `getExpectedIamAudiences()` foi introduzida, unificando a resolução da URL real e esperada do Cloud Run (`CLOUD_RUN_SERVICE_URL`, `STAGING_BACKEND_URL`, `EXPECTED_AUDIENCE`, `ALLOWED_AUDIENCES`).
  - Em ambiente de staging/produção, a validação falha imediatamente (`MISSING_EXPECTED_AUDIENCE_CONFIG`) se nenhuma audience esperada estiver configurada, impedindo bypass silencioso.
  - O campo `aud` do token é validado criptograficamente contra a URL real do Cloud Run. Tokens emitidos para outros serviços ou URLs divergentes são estritamente rejeitados com `INVALID_IAM_AUDIENCE`.

### 1.2 Remoção Integral de Padrões de E-mail com Curingas
- **Problema anterior:** Existia no código a regra permissiva `email.endsWith('@itissimple-security-staging.iam.gserviceaccount.com')`, que autorizava indiscriminadamente qualquer conta de serviço criada no projeto (incluindo SAs de CI/CD, batch ou de menor privilégio).
- **Correção implementada:**
  - **100% eliminada qualquer verificação baseada em sufixos, regex ou curingas.**
  - A função `isAuthorizedIamPrincipal(email)` rejeita explicitamente qualquer string ou entrada que contenha o caractere `*`.
  - Injeção acidental ou maliciosa de curingas na variável de ambiente `ALLOWED_IAM_CALLERS` é estritamente ignorada.

### 1.3 Allowlist Explícita de Identidades Autorizadas
- A autorização agora exige correspondência exata contra uma allowlist estrita (`EXPLICIT_AUTHORIZED_IAM_IDENTITIES`):
  1. `sa-diagnostic-backend@itissimple-security-staging.iam.gserviceaccount.com` (SA de execução da instância Cloud Run);
  2. `sa-diagnostic-caller@itissimple-security-staging.iam.gserviceaccount.com` (SA dedicada para invocação de testes diagnósticos);
  3. `adm.itissimple@gmail.com` (Administrador de segurança staging);
  4. `admin@itissimple.com` (Identidade administrativa secundária);
  5. Principais adicionais configurados por endereço completo e exato em `ALLOWED_IAM_CALLERS`.
- A identidade inspecionada do token deve corresponder rigorosamente ao principal cadastrado.

### 1.4 Princípio de Não-Concessão por `email_verified=true` Isolado
- Ter `email_verified: true` é uma precondição necessária de integridade do Google Accounts, mas **nunca suficiente** para conceder acesso.
- Qualquer usuário do Google com e-mail verificado fora da allowlist explícita é rejeitado com `403 Forbidden` (`UNAUTHORIZED_IAM_IDENTITY`).

### 1.5 Anti-Confusão: Separação de Tokens Firebase Auth e OIDC IAM
- **Risco mitigado:** Um token de ID emitido pelo Firebase Authentication para usuários de frontend (`iss: https://securetoken.google.com/itissimple-security-staging`, `aud: itissimple-security-staging`) não pode, sob nenhuma hipótese, ser aceito ou interpretado como credencial IAM de invocação do Cloud Run.
- **Proteção:**
  - A função `isFirebaseIdToken(token)` inspeciona a estrutura JWT antes e durante a validação.
  - Se o emissor for `securetoken.google.com` ou o payload contiver claims da namespace `firebase`, o token é sumariamente rejeitado com `FIREBASE_AUTH_TOKEN_REJECTED`.
  - Essa rejeição ocorre mesmo se o e-mail do usuário do Firebase coincidir com o e-mail de um administrador.

### 1.6 Manutenção de `DIAGNOSTIC_ONLY=true` e Isolamento Integral
- O backend dedicado permanece com isolamento absoluto:
  - Rotas de alunos, professores, aulas, tarefas, dicionário e autenticação retornam `404 Not Found` (`diagnosticMode: true`).
  - Nenhuma operação de I/O em `app_db.json`.
  - Nenhuma sincronização de background ativada.
  - Ativação exclusiva via variável de servidor (`DIAGNOSTIC_ONLY=true`), imune a parâmetros de URL ou headers HTTP.

### 1.7 Bateria de Testes Negativos e Criptográficos
- Criados testes automatizados em `test/validate-fase-1d.ts` cobrindo:
  1. **Audience incorreta:** Rejeição padronizada com `INVALID_IAM_AUDIENCE` (403 Forbidden).
  2. **Emissor incorreto:** Rejeição padronizada com `INVALID_IAM_ISSUER` (403 Forbidden).
  3. **Token expirado:** Rejeição padronizada com `TOKEN_EXPIRED` (403 Forbidden).
  4. **Identidade não autorizada (SA não listada no mesmo projeto):** Confirmação da remoção do wildcard com `UNAUTHORIZED_IAM_IDENTITY` (403 Forbidden).
  5. **Usuário com `email_verified=true` mas fora da allowlist:** Rejeição com `UNAUTHORIZED_IAM_IDENTITY` (403 Forbidden).
  6. **Token Firebase Auth utilizado como credencial IAM:** Rejeição com `FIREBASE_AUTH_TOKEN_REJECTED` (403 Forbidden).
  7. **Assinatura criptográfica RSA-SHA256 forjada / adulterada:** Rejeição criptográfica com `INVALID_IAM_CREDENTIALS`.

### 1.8 Confirmação do Dockerfile para Modo Diagnóstico no Cloud Run
- O arquivo `Dockerfile` define explicitamente:
  ```dockerfile
  ENV DIAGNOSTIC_ONLY=true
  CMD ["node", "server.ts"]
  ```
- O bootloader `server.ts` verifica `process.env.DIAGNOSTIC_ONLY === 'true'`, importando exclusivamente `src/diagnosticApp.ts` e executando `startDiagnosticServer()`. O código de negócio (`serverApp.ts`) nunca é carregado na memória do container.

---

## 2. Resultados dos Testes Automatizados

Execução completa da bateria de testes locais com mocks controlados e validação criptográfica RSA-SHA256:

- **Bateria Fase 1D (Geral + 1D.2):** `npx tsx test/validate-fase-1d.ts`  
  - Total de testes: **144**  
  - Sucessos: **144**  
  - Falhas: **0**  

- **Bateria Fase 1C (Cliente & Servidor):** `npx tsx test/validate-fase-1c.ts`  
  - Total de testes: **48**  
  - Sucessos: **48**  
  - Falhas: **0**  

- **Verificação TypeScript / Linter:** `npm run lint`  
  - Erros: **0**  

---

## 3. Checklist Objetivo para Autorização do Primeiro Deploy Privado

Antes de autorizar o deploy do container no Google Cloud Run, verifique os seguintes critérios:

- [x] **1. Isolamento de Código:** Servidor roda sob `DIAGNOSTIC_ONLY=true`; rotas de negócio desativadas (404).
- [x] **2. Projeto Exclusivo:** Configuração travada em `itissimple-security-staging`; zero referências operacionais ao projeto legado `itissimple-8663d`.
- [x] **3. Zero Curingas:** Permissões baseadas em `*@...` completamente eliminadas; allowlist explícita implementada.
- [x] **4. Validação de Audience:** Audience (`aud`) validada contra a URL esperada do serviço Cloud Run.
- [x] **5. Separação de Credenciais:** Tokens do Firebase Auth rejeitados sumariamente para invocações Cloud Run IAM.
- [x] **6. Defesa em Profundidade:** `/api/diagnostic/firestore` protegido por middleware IAM nativo com autenticação obrigatória (rejeita anônimos com 401).
- [x] **7. Dockerfile Conforme:** `ENV DIAGNOSTIC_ONLY=true` e inicialização limpa via `server.ts`.
- [x] **8. Testes Negativos Validados:** 144 testes automatizados aprovados sem erros.
- [ ] **9. Autorização Humana Explícita:** Aguardando comando explícito do operador para criar a Service Account e disparar o deploy privado no Cloud Run.
