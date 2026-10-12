# Auditoria de Compatibilidade, Segurança e Execução Stateless — Fase 1C

**Projeto Exclusivo:** `itissimple-security-staging`  
**Escopo:** Backend Express Dedicado no Cloud Run & Arquitetura Stateless  

---

## 1. Auditoria de CORS (Cross-Origin Resource Sharing)

### Diagnóstico Anterior
Anteriormente, o middleware de CORS refletia dinamicamente qualquer cabeçalho `Origin` recebido em conjunto com `Access-Control-Allow-Credentials: true`. Embora funcional para desenvolvimento local, essa prática viola o princípio do privilégio mínimo em ambientes de produção expostos na nuvem.

### Implementação Hardened (Fase 1C)
Foi introduzida a função de validação rigorosa `isAuthorizedOrigin(origin: string): boolean`, acoplada diretamente ao middleware Express (`serverApp.ts`):

1. **Origens Estritamente Permitidas:**
   - **Ambiente de Desenvolvimento Local:**
     - `http://localhost:*` (portas 3000, 5173, 8080)
     - `http://127.0.0.1:*`
     - `http://0.0.0.0:*`
   - **Contêineres e Serviços Cloud Run:**
     - Domínios com sufixo `.run.app` (ex.: `https://*.run.app`)
   - **Plataforma AI Studio & Google Preview:**
     - `https://*.aistudio.google.com`
     - `https://*.google.com`
     - `https://*.googleusercontent.com`
   - **Firebase Hosting Staging:**
     - `https://itissimple-security-staging.web.app`
     - `https://itissimple-security-staging.firebaseapp.com`
     - Qualquer domínio sob `.web.app` ou `.firebaseapp.com` vinculado ao projeto staging.
   - **Origens Adicionais Configuráveis:**
     - Lista controlada via variável de ambiente `ALLOWED_CORS_ORIGINS` (separada por vírgula).

2. **Comportamento para Origens Não Autorizadas:**
   - Requisições preflight (`OPTIONS`): respondidas imediatamente com `403 Forbidden` (`CORS policy: origin unauthorized`).
   - Requisições comuns: nenhum cabeçalho `Access-Control-Allow-Origin` é retornado com credenciais, forçando o navegador a descartar a resposta.

---

## 2. Auditoria de Integrações Externas

### 2.1 Google OAuth, Calendar, Meet e Google Drive
- **Mecanismo:** Os tokens de acesso OAuth são obtidos via popup de consentimento no cliente (`GoogleAuthProvider` com scopes restritos: `drive.file`, `calendar.events`, `gmail.send`).
- **Comunicação Cliente-Servidor:** O token de acesso Google é enviado pelo cliente no cabeçalho `Authorization: Bearer <token>` ou `X-Google-Access-Token`.
- **Statelessness:** O servidor backend **não** armazena `refresh_tokens` em disco nem possui sessões em memória para comunicação com o Google Drive/Calendar. Todas as operações utilizam as APIs REST oficiais do Google v3 de forma stateless por requisição.
- **Isolamento de Contas:** As pastas do Google Drive são criadas sob a conta do próprio professor autenticado (`drive.file`), sem necessidade de chaves de serviço corporativas no contêiner.

### 2.2 Google Gemini AI (Modelos Multimodais e de Linguagem)
- **Biblioteca:** SDK TypeScript `@google/genai` (`GoogleGenAI`).
- **Modelo:** `gemini-3.6-flash` (ou `gemini-2.5-flash`), com fallback determinístico caso o modelo de ambiente seja inválido.
- **Autenticação:** `GEMINI_API_KEY` injetada via variável de ambiente. No Cloud Run, a chave será montada a partir do Google Secret Manager.
- **Statelessness:** Cada requisição de correção gramatical, elaboração de tarefas ou síntese pedagógica é autônoma, sem persistência de estado em memória do processo.

### 2.3 Spotify & YouTube
- **Mapeamento e Validação:** URLs de músicas e vídeos são validadas por analisadores regex determinísticos (`parseSpotifyUrl`, `extractYouTubeVideoId`).
- **Armazenamento de Metas e Mídias:** A listagem de playlists curadas e as atribuições diárias são persistidas no Cloud Firestore (`app_state/youtube_playlists`, `app_state/assignments`).
- **Statelessness:** Nenhuma mídia binária (áudio/vídeo) trafega pelo servidor; apenas identificadores canônicos e metadados estruturados.

---

## 3. Identificação de Dependências de Memória e Disco (Statelessness)

| Componente Atual | Comportamento no Contêiner | Risco em Cloud Run | Solução e Mitigação Fase 1C |
| :--- | :--- | :--- | :--- |
| **`app_db.json` (Disco Local)** | `saveToDiskSync` grava em `src/data/app_db.json` | O sistema de arquivos de instâncias Cloud Run é efêmero e não compartilhado entre instâncias. | Em contêiner Cloud Run, `saveToDiskSync` trata falhas de disco sem interromper o processo. O Cloud Firestore é estabelecido como a **fonte única de verdade**. |
| **`inMemoryDb` (Cache em RAM)** | Mantém réplica em memória para respostas rápidas | Instâncias independentes poderiam ter visões ligeiramente defasadas caso houvesse escrita concorrente. | O servidor sincroniza diretamente coleções canônicas (`/users`, `/tutors`, `/session_notes`, `/homework`, `app_state/*`) com o Cloud Firestore. Na Fase 2, leituras dinâmicas poderão consultar o Firestore com TTL de cache. |
| **Variável `PORT`** | Anteriormente lia prioritariamente `APP_PORT` | O Cloud Run atribui a porta dinâmica (geralmente 8080) através de `PORT`. | O servidor foi atualizado para priorizar `process.env.PORT`. |
| **Vite Dev Server** | Iniciava o middleware Vite acoplado em modo não-produção | Impossibilitava o contêiner de backend de iniciar de forma leve e autônoma. | Adicionado suporte a `STANDALONE_BACKEND=true`, permitindo que o Express suba sem nenhuma dependência do Vite ou do pacote do frontend. |

---

## 4. Política Anti-Armazenamento Local

- **Proibição Estrita:** Nenhum novo mecanismo de armazenamento local (SQLite, NeDB, LevelDB, arquivos JSON de sessão ou cookies de estado em disco) foi ou será introduzido.
- **Persistência Exclusiva:** Todas as gravações permanentes têm como destino exclusivo as coleções autorizadas do Cloud Firestore do projeto `itissimple-security-staging`.

---

## 5. Tratamento de Falhas do Firestore (Zero False-Success)

- **Diretriz de Integridade:** O backend nunca deve retornar código `200 OK` com `{ success: true }` caso a gravação no Cloud Firestore tenha falhado.
- **Implementação:**
  - Quando a flag `STRICT_FIRESTORE=true` está ativa (ou em modo de produção Cloud Run), operações que falharem no Firestore retornarão `500 Internal Server Error` ou `503 Service Unavailable` com código `DatabasePersistenceError`.
  - A interface e o cliente HTTP centralizado (`apiClient`) capturam esse erro e alertam o usuário, impedindo que dados pareçam salvos quando não foram confirmados na nuvem.
