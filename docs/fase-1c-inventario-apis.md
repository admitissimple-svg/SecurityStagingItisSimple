# Inventário Completo de Rotas de API (`/api/*`) — Fase 1C

**Projeto Exclusivo:** `itissimple-security-staging`  
**Escopo:** Centralização do tráfego backend Express no Cloud Run  

---

## 1. Visão Geral

Todas as chamadas de API do sistema foram catalogadas a partir do servidor Express (`serverApp.ts`) e dos componentes e hooks do frontend React (`src/`). 

As chamadas utilizam a convenção de prefixo `/api/*` e contam agora com o cliente centralizado `src/utils/apiClient.ts` com suporte à variável de ambiente `VITE_BACKEND_API_URL`, preservação transparente dos Firebase ID Tokens e tratamento uniforme de códigos de erro HTTP (401, 403, 500 e 503).

---

## 2. Matriz de Endpoints por Módulo

### 2.1 Saúde, Monitoramento & Diagnóstico

| Método | Endpoint | Nível de Autenticação | Descrição & Payload | Entidade Firestore |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Público | Verificação de integridade e liveness probe do Cloud Run | N/A (Status de processo) |
| `GET` | `/` | Público (Standalone) | Status do serviço dedicado Cloud Run (quando `STANDALONE_BACKEND=true`) | N/A |

---

### 2.2 Autenticação, Sessão & Permissões (Firebase Auth)

| Método | Endpoint | Nível de Autenticação | Descrição & Payload | Entidade Firestore / Auth |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/auth/verify-session` | Bearer Token (Qualquer) | Valida Firebase ID Token no backend e inspeciona claims | Firebase Admin Auth |
| `POST` | `/api/auth/sync-admin-claims` | Bearer Token (Admin verificado) | Atribui custom claim `role=admin` para e-mails confiáveis (`adm.itissimple@gmail.com`) | Firebase Admin Auth Custom Claims |
| `GET` | `/api/auth/admin-status` | Público | Verifica status inicial de provisionamento de administrador | `app_state/main_data` |
| `POST` | `/api/auth/login` | Público / Credenciais | Autenticação legada e validação de perfil inicial | `/users`, `app_state/main_data` |
| `POST` | `/api/auth/reset-password` | Público | Solicitação de redefinição de senha | Firebase Auth |
| `GET` | `/api/auth/check-user` | Público | Verificação prévia de existência de usuário por e-mail | `/users` |
| `POST` | `/api/auth/sync-local-users` | Público | Sincronização inicial de contas | `/users` |
| `POST` | `/api/auth/register` | Público | Registro de nova conta (aluno) | `/users`, Firebase Auth |
| `POST` | `/api/auth/signup` | Público | Alias de registro | `/users`, Firebase Auth |
| `POST` | `/api/auth/google` | Público / Google Credential | Sincronização de usuário autenticado via Google Sign-In | `/users` |

---

### 2.3 Gestão de Amigos Nativos / Professores (Tutors)

| Método | Endpoint | Nível de Autenticação | Descrição & Payload | Entidade Firestore |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/tutors` | Público / Projeção Segura | Catálogo público (professores aprovados). Se autenticado como professor, projeta dados próprios | `/tutors`, `/users`, `app_state/tutors` |
| `POST` | `/api/tutors` | Público / Candidatura | Submissão de cadastro de tutor (forçado `approvalStatus=pending`, `role=teacher`) | `/tutors/{id}`, `/users/{id}`, `app_state/tutors` |
| `PUT` | `/api/tutors/:id` | Bearer Token (Próprio ou Admin) | Edição de perfil do tutor. Impede auto-aprovação ou escalada | `/tutors/{id}`, `/users/{id}` |
| `DELETE` | `/api/tutors/:id` | Bearer Token (Admin Exclusivo) | Exclusão de professor da plataforma | `/tutors/{id}`, `/users/{id}`, `app_state/tutors` |
| `POST` | `/api/tutors/:id/approve` | Bearer Token (Admin Exclusivo) | Aprovação oficial de professor para o catálogo público | `/tutors/{id}`, `/users/{id}`, `app_state/tutors` |
| `POST` | `/api/tutors/:id/reject` | Bearer Token (Admin Exclusivo) | Rejeição de candidatura de professor | `/tutors/{id}`, `/users/{id}`, `app_state/tutors` |
| `GET` | `/api/teachers` | Bearer Token (Admin Exclusivo) | Listagem administrativa de professores com dados de moderação | `/users`, `app_state/tutors` |
| `POST` | `/api/teachers` | Bearer Token (Admin Exclusivo) | Criação administrativa de perfil de professor | `/users`, `app_state/tutors` |
| `DELETE` | `/api/teachers/:email` | Bearer Token (Admin Exclusivo) | Remoção administrativa de professor por e-mail | `/users`, `app_state/tutors` |

---

### 2.4 Alunos, Matrículas & Perfis

| Método | Endpoint | Nível de Autenticação | Descrição & Payload | Entidade Firestore |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/students` | Autenticado / Admin | Listagem de alunos ativos | `/users`, `app_state/main_data` |
| `POST` | `/api/students` | Autenticado / Admin | Criação ou atualização de aluno | `/users`, `app_state/main_data` |
| `DELETE` | `/api/students/:identifier` | Bearer Token (Admin Exclusivo) | Exclusão de aluno com blacklist e limpeza de subcoleções | `/users/{id}`, `app_state/main_data` |
| `POST` | `/api/admin/clean-obsolete-users`| Bearer Token (Admin Exclusivo) | Purga de contas obsoletas de teste | `/users`, `app_state/main_data` |
| `GET` | `/api/user-profile` | Autenticado | Leitura do perfil do usuário | `/users/{uid}` |
| `POST` | `/api/user-profile` | Autenticado | Atualização do perfil do usuário | `/users/{uid}` |
| `POST` | `/api/students/profile` | Autenticado | Atualização de metas de estudo | `/users/{uid}` |
| `POST` | `/api/students/purchase-package` | Autenticado | Contratação de pacote de aulas | `/users/{uid}`, `app_state/lessons` |
| `POST` | `/api/students/contract` | Autenticado | Atualização de saldo de aulas contratadas | `/users/{uid}` |
| `POST` | `/api/students/cancel` | Autenticado | Cancelamento de matrícula de aluno | `/users/{uid}` |
| `GET` | `/api/contracted-lessons` | Autenticado | Consulta de aulas disponíveis | `/users/{uid}`, `app_state/lessons` |
| `POST` | `/api/contracted-lessons` | Autenticado | Ajuste de créditos de aulas | `/users/{uid}`, `app_state/lessons` |

---

### 2.5 Rotinas & Metas Semanais (The Habit Science)

| Método | Endpoint | Nível de Autenticação | Descrição & Payload | Entidade Firestore |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/routines` | Autenticado | Consulta da rotina padrão por dia | `app_state/routines` |
| `POST` | `/api/routines` | Autenticado | Salvar rotina de atividades diárias | `app_state/routines` |
| `POST` | `/api/routines/words` | Autenticado | Salvar palavras-chave de uma atividade | `app_state/routines` |
| `POST` | `/api/routines/toggle` | Autenticado | Alternar status concluído de atividade | `app_state/routines` |
| `POST` | `/api/routines/update-time` | Autenticado | Ajustar horário preferido da rotina | `app_state/routines` |
| `GET` | `/api/student-routines` | Autenticado | Rotinas específicas do aluno | `/users/{uid}/routines`, `app_state/routines` |
| `POST` | `/api/student-routines/start-new-week` | Autenticado | Início de novo ciclo semanal com reset de repetições | `/users/{uid}/routines` |
| `POST` | `/api/student/reset-week` | Autenticado | Reset individual do ciclo semanal do aluno | `/users/{uid}/routines` |
| `GET` | `/api/routines/current-routine` | Autenticado | Consulta da rotina em andamento no dia | `app_state/routines` |
| `POST` | `/api/routines/current-routine` | Autenticado | Atualiza atividade atual da rotina | `app_state/routines` |
| `POST` | `/api/routines/current-routine/feedback` | Autenticado | Envia feedback sobre a rotina | `app_state/routines` |
| `GET` | `/api/routines/weekly-checks` | Bearer Token | Leitura dos checks diários cumpridos | `/users/{uid}/weekly_checks` |
| `POST` | `/api/routines/weekly-checks` | Bearer Token | Gravação dos checks diários cumpridos | `/users/{uid}/weekly_checks` |

---

### 2.6 Aulas ao Vivo (Live Meet Lessons) & Agendamentos

| Método | Endpoint | Nível de Autenticação | Descrição & Payload | Entidade Firestore |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/lessons` | Autenticado | Leitura de histórico e agendamentos de aulas | `app_state/lessons` |
| `GET` | `/api/live-lessons` | Autenticado | Alias de leitura de aulas | `app_state/lessons` |
| `POST` | `/api/lessons` | Autenticado | Agendamento de nova aula ao vivo | `app_state/lessons` |
| `POST` | `/api/live-lessons` | Autenticado | Alias de agendamento | `app_state/lessons` |
| `POST` | `/api/lessons/:id/complete` | Autenticado (Professor/Admin) | Marcação de aula realizada com sucesso | `app_state/lessons` |
| `POST` | `/api/lessons/:id/not-completed` | Autenticado (Professor/Admin) | Registro de não comparecimento | `app_state/lessons` |
| `POST` | `/api/lessons/:id/reschedule` | Autenticado | Solicitação de reagendamento | `app_state/lessons` |
| `POST` | `/api/lessons/:id/accept-reschedule` | Autenticado | Aceite de reagendamento | `app_state/lessons` |
| `POST` | `/api/lessons/:id/decline-reschedule` | Autenticado | Recusa de reagendamento | `app_state/lessons` |
| `POST` | `/api/lessons/:id/cancel` | Autenticado | Cancelamento formal de aula | `app_state/lessons` |
| `DELETE` | `/api/lessons/:id` | Autenticado (Admin) | Exclusão de registro de aula | `app_state/lessons` |
| `POST` | `/api/lessons/:id/notes` | Autenticado (Professor) | Registro de anotações pedagógicas da aula | `/session_notes`, `app_state/lessons` |

---

### 2.7 Notas Pedagógicas, Diário do Aluno & Google Drive

| Método | Endpoint | Nível de Autenticação | Descrição & Payload | Entidade Firestore |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/session-notes` | Autenticado (Professor) | Gravação de anotações da sessão com vocabulário | `/session_notes/{id}` |
| `GET` | `/api/session-notes` | Autenticado | Consulta de anotações pedagógicas | `/session_notes` |
| `POST` | `/api/drive/sync-session-notes` | Autenticado (Google OAuth) | Sincroniza PDF/HTML da nota na pasta do Drive do professor | Google Drive v3 REST API |
| `GET` | `/api/drive/files/:fileId` | Autenticado | Metadados de arquivo no Google Drive | Google Drive v3 REST API |
| `GET` | `/api/drive/files/:fileId/download` | Autenticado | Download de arquivo do Google Drive | Google Drive v3 REST API |
| `GET` | `/api/session-notes/progress` | Autenticado | Progresso das notas de sessão | `app_state/lessons` |
| `POST` | `/api/session-notes/progress` | Autenticado | Atualiza progresso das notas | `app_state/lessons` |
| `POST` | `/api/pedagogical-notes/transform` | Autenticado | Transforma anotações em histórias e exercícios via Gemini | Gemini Flash API |
| `GET` | `/api/pedagogical-notes` | Autenticado | Consulta transformações pedagógicas | `app_state/lessons` |
| `GET` | `/api/student-dictionary` | Autenticado | Leitura do dicionário pessoal do aluno | `/users/{uid}/dictionary` |
| `POST` | `/api/student-dictionary` | Autenticado | Adiciona termo ao dicionário pessoal | `/users/{uid}/dictionary` |
| `GET` | `/api/student-journal` | Autenticado | Leitura do diário de aprendizado do aluno | `/users/{uid}/journal` |
| `POST` | `/api/student-journal` | Autenticado | Salvar entrada no diário | `/users/{uid}/journal` |
| `GET` | `/api/student-journal/activity` | Autenticado | Histórico de atividades do diário | `/users/{uid}/activity_journal` |
| `POST` | `/api/student-journal/activity` | Autenticado | Gravação de atividade no diário | `/users/{uid}/activity_journal` |
| `DELETE` | `/api/student-journal/activity` | Autenticado | Remoção de item do diário | `/users/{uid}/activity_journal` |

---

### 2.8 Mídia & Integrações Externas (YouTube & Spotify)

| Método | Endpoint | Nível de Autenticação | Descrição & Payload | Entidade Firestore |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/youtube-playlists` | Público / Aluno | Playlists curadas por nível | `app_state/youtube_playlists` |
| `POST` | `/api/youtube-playlists/sync` | Autenticado (Admin) | Sincroniza playlists com o YouTube | `app_state/youtube_playlists` |
| `POST` | `/api/youtube-playlists/save` | Autenticado (Admin) | Salva playlists curadas no banco | `app_state/youtube_playlists` |
| `GET` | `/api/student-video-assignments` | Autenticado | Vídeos atribuídos à semana do aluno | `app_state/assignments` |
| `POST` | `/api/student-video-assignments/assign` | Autenticado (Professor) | Atribui vídeo a dia da rotina | `app_state/assignments` |
| `POST` | `/api/student-video-assignments/distribute-week` | Autenticado | Distribui vídeos automaticamente | `app_state/assignments` |
| `POST` | `/api/student-video-assignments/watch` | Autenticado (Aluno) | Registra vídeo assistido | `app_state/assignments` |
| `POST` | `/api/routines/daily-video` | Autenticado | Atualiza vídeo diário da rotina | `app_state/assignments` |
| `GET` | `/api/spotify-playlists` | Público / Aluno | Playlists de músicas curadas | `app_state/assignments` |
| `POST` | `/api/spotify-playlists/sync` | Autenticado (Admin) | Sincroniza faixas do Spotify | `app_state/assignments` |
| `GET` | `/api/student-spotify-assignments` | Autenticado | Faixas do Spotify atribuídas ao aluno | `app_state/assignments` |
| `POST` | `/api/student-spotify-assignments/assign` | Autenticado (Professor) | Atribui faixa a dia da semana | `app_state/assignments` |
| `POST` | `/api/student-spotify-assignments/distribute-week` | Autenticado | Distribui faixas musicais para a semana | `app_state/assignments` |
| `POST` | `/api/student-spotify-assignments/listen` | Autenticado (Aluno) | Marca faixa ou podcast como ouvido | `app_state/assignments` |
| `GET` | `/api/spotify/validate-link` | Autenticado | Valida formato e integridade de link Spotify | Validador regex Spotify |
| `POST` | `/api/spotify/validate-link` | Autenticado | Validação via body | Validador regex Spotify |
| `GET` | `/api/spotify/verify` | Autenticado | Verificação de integridade de faixa | Spotify API |

---

### 2.9 Inteligência Artificial & Pedagogia (Gemini API)

| Método | Endpoint | Nível de Autenticação | Descrição & Payload | Integração Externa |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/homework` | Bearer Token | Leitura dos exercícios semanais gerados | `/homework/{uid}` |
| `POST` | `/api/homework` | Bearer Token | Salvamento de respostas do dever de casa | `/homework/{uid}` |
| `POST` | `/api/homework/submit` | Bearer Token | Envio final para avaliação pedagógica | `/homework/{uid}` |
| `POST` | `/api/homework/generate-ai` | Autenticado | Geração de história pedagógica e 4 questões baseadas na rotina | Gemini Flash API |
| `POST` | `/api/homework/generate-part4` | Autenticado | Geração de exercícios Fill-in-the-Blanks | Gemini Flash API |
| `POST` | `/api/homework/generate-story` | Autenticado | Síntese de narrativa contextualizada | Gemini Flash API |
| `POST` | `/api/homework/evaluate` | Autenticado | Avaliação e correção detalhada de respostas abertas | Gemini Flash API |
| `POST` | `/api/check-daily-sentence` | Autenticado | Análise gramatical e enriquecimento da frase do dia | Gemini Flash API |
| `POST` | `/api/check-writing` | Autenticado | Correção gramatical determinística e sugestões pedagógicas | Gemini Flash API |
| `POST` | `/api/lesson/vocab-generate` | Autenticado | Geração automática de vocabulário e definições pedagógicas | Gemini Flash API |

---

### 2.10 Notificações, Mensagens Diretas & CMS

| Método | Endpoint | Nível de Autenticação | Descrição & Payload | Entidade Firestore |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/chat-messages` | Autenticado | Leitura de mensagens diretas entre aluno e professor | `app_state/main_data` |
| `POST` | `/api/chat-messages` | Autenticado | Envio de nova mensagem direta | `app_state/main_data` |
| `DELETE` | `/api/chat-messages` | Autenticado (Admin) | Limpeza de histórico de mensagens | `app_state/main_data` |
| `GET` | `/api/landing-content` | Público | Textos institucionais e pilares pedagógicos da Landing Page | `app_state/main_data` |
| `POST` | `/api/landing-content` | Bearer Token (Admin Exclusivo) | Atualização dos textos da Landing Page | `app_state/main_data` |
| `POST` | `/api/email-logs` | Autenticado | Registro de log de comunicações por e-mail | `app_state/main_data` |

---

## 3. Diretrizes de Invocação pelo Frontend

1. **Uso Exclusivo do `apiClient`:**
   ```typescript
   import apiClient from '../utils/apiClient';

   // Leitura protegida: o token do Firebase Auth do usuário logado é anexado automaticamente
   const data = await apiClient.get('/api/homework');

   // Envio de dados autenticado:
   await apiClient.post('/api/student-dictionary', { term: 'commute', translationPt: 'trajeto diário' });
   ```

2. **Tratamento de Exceções Centralizado:**
   ```typescript
   try {
     await apiClient.post('/api/tutors/tutor-123/approve');
   } catch (error) {
     if (error instanceof ApiError) {
       if (error.isUnauthorized) {
         // Código 401: redireciona para login ou abre AuthModal
       } else if (error.isForbidden) {
         // Código 403: exibe alerta de permissão insuficiente
       } else if (error.isServiceUnavailable) {
         // Código 503: informa que o Cloud Run está em processo de inicialização
       }
     }
   }
   ```

3. **Chaveamento Dinâmico de Destino:**
   - Na versão publicada atual, `VITE_BACKEND_API_URL` não é definida, resultando em chamadas relativas (mesma origem) sem alterar o comportamento existente.
   - Quando a Service Account e o serviço Cloud Run forem provisionados, basta configurar `VITE_BACKEND_API_URL=https://<service-url>.run.app` no cliente frontend.
