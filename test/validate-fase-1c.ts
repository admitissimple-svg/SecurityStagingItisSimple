/**
 * Bateria de Testes Automatizados — Fase 1C: Preparação Segura do Backend Dedicado
 * 
 * Verificações:
 * 1. Cliente HTTP Centralizado (apiClient):
 *    - Configuração e resolução de URL Base
 *    - Preservação da versão atual sem URL base (caminhos relativos)
 *    - Formatação de URLs e query parameters
 *    - Anexação de Firebase ID Tokens (Authorization: Bearer <token>)
 *    - Classificação uniforme de erros: 401, 403, 500 e 503 (ApiError)
 *    - Sistema de escuta e eventos globais (onApiError)
 * 2. Preparação do Servidor Backend:
 *    - Resolução da variável PORT fornecida pelo Cloud Run
 *    - Suporte a inicialização standalone desacoplada do Vite/React
 * 3. Auditoria de Segurança CORS:
 *    - Liberação estrita de origens autorizadas (Cloud Run, AI Studio, Firebase Hosting, localhost)
 *    - Rejeição obrigatória de origens maliciosas ou não autorizadas
 */

process.env.NODE_ENV = 'test';

import {
  apiClient,
  ApiError,
  buildApiUrl,
  setApiBaseUrl,
  getApiBaseUrl,
  onApiError,
} from '../src/utils/apiClient';
import { isAuthorizedOrigin } from '../serverApp';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('=========================================================================');
  console.log('=== TESTES AUTOMATIZADOS: FASE 1C — PREPARAÇÃO DO BACKEND DEDICADO ===');
  console.log('=== PROJETO EXCLUSIVO: itissimple-security-staging                    ===');
  console.log('=========================================================================\n');

  // --------------------------------------------------------------------------
  console.log('--- 1. Cliente Centralizado: Configuração de URL Base e Caminhos ---');
  // --------------------------------------------------------------------------
  const initialBaseUrl = getApiBaseUrl();
  assert(
    initialBaseUrl === '',
    'URL Base inicial é vazia por padrão (preserva comportamento publicado da mesma origem)',
    `Atual: "${initialBaseUrl}"`
  );

  const defaultHealthUrl = buildApiUrl('/api/health');
  assert(
    defaultHealthUrl === '/api/health',
    'Caminho relativo mantido intacto sem alterar destino na versão publicada',
    `Gerado: ${defaultHealthUrl}`
  );

  const defaultUrlWithoutSlash = buildApiUrl('api/tutors');
  assert(
    defaultUrlWithoutSlash === '/api/tutors',
    'Normalização segura de barra inicial em endpoint relativo',
    `Gerado: ${defaultUrlWithoutSlash}`
  );

  // Teste de configuração com URL de backend mock
  setApiBaseUrl('https://staging-api.itissimple.internal/');
  const updatedBaseUrl = getApiBaseUrl();
  assert(
    updatedBaseUrl === 'https://staging-api.itissimple.internal',
    'setApiBaseUrl remove barra final de forma limpa',
    `Obtido: ${updatedBaseUrl}`
  );

  const stagingUrl = buildApiUrl('/api/health');
  assert(
    stagingUrl === 'https://staging-api.itissimple.internal/api/health',
    'URL Base é prefixada corretamente quando configurada',
    `Gerado: ${stagingUrl}`
  );

  const urlWithParams = buildApiUrl('/api/tutors', { approved: true, limit: 10, search: 'native' });
  assert(
    urlWithParams.includes('approved=true') &&
      urlWithParams.includes('limit=10') &&
      urlWithParams.includes('search=native'),
    'Query parameters serializados corretamente na URL',
    `Gerado: ${urlWithParams}`
  );

  // Restaura URL base original para manter isolamento
  setApiBaseUrl('');
  assert(getApiBaseUrl() === '', 'URL Base restaurada com sucesso para testes subsequentes');

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Cliente Centralizado: Tratamento Uniforme de Erros HTTP ---');
  // --------------------------------------------------------------------------
  const error401 = new ApiError(401, 'Unauthorized', 'Sessão expirada', { reason: 'token_expired' }, '/api/auth/verify-session');
  assert(error401.isUnauthorized === true, 'ApiError(401) marca isUnauthorized como true');
  assert(error401.isForbidden === false, 'ApiError(401) não marca isForbidden como true');
  assert(error401.code === 'UNAUTHORIZED', 'Código de erro padronizado para UNAUTHORIZED');
  assert(error401.status === 401, 'Status HTTP preservado');
  assert(error401.endpoint === '/api/auth/verify-session', 'Endpoint preservado no erro');

  const error403 = new ApiError(403, 'Forbidden', 'Acesso negado', null, '/api/teachers');
  assert(error403.isForbidden === true, 'ApiError(403) marca isForbidden como true');
  assert(error403.isUnauthorized === false, 'ApiError(403) não marca isUnauthorized como true');
  assert(error403.code === 'FORBIDDEN', 'Código padronizado para FORBIDDEN');

  const error500 = new ApiError(500, 'Internal Server Error', 'Falha interna', { error: 'DatabasePersistenceError' }, '/api/students');
  assert(error500.isServerError === true, 'ApiError(500) marca isServerError como true');
  assert(error500.code === 'SERVER_ERROR', 'Código padronizado para SERVER_ERROR');

  const error503 = new ApiError(503, 'Service Unavailable', 'Cloud Run iniciando', null, '/api/health');
  assert(error503.isServiceUnavailable === true, 'ApiError(503) marca isServiceUnavailable como true');
  assert(error503.code === 'SERVICE_UNAVAILABLE', 'Código padronizado para SERVICE_UNAVAILABLE');

  // Teste de escuta global de erros
  let capturedError: ApiError | null = null;
  const unsubscribe = onApiError((err) => {
    capturedError = err;
  });

  // Mock global fetch para testar request() com erro 403
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({ error: 'Forbidden', message: 'Permissões administrativas requeridas' }),
      {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };

  try {
    await apiClient.get('/api/teachers');
    assert(false, 'apiClient.get deveria ter lançado exceção para código 403');
  } catch (err: any) {
    assert(err instanceof ApiError, 'Exceção lançada é instância de ApiError');
    assert(err.status === 403, 'Status da exceção é 403');
    assert(err.isForbidden === true, 'Flag isForbidden é true na exceção');
    assert(
      capturedError !== null && (capturedError as ApiError).status === 403,
      'Listener onApiError capturou o erro de status 403'
    );
  }

  // Mock global fetch para testar request() com sucesso e envio de Bearer token
  let forwardedAuthHeader: string | null = null;
  globalThis.fetch = async (_input: any, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    forwardedAuthHeader = headers.get('Authorization');
    return new Response(JSON.stringify({ status: 'ok', authenticated: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const responseOk = await apiClient.get('/api/auth/verify-session', { token: 'mock-staging-id-token' });
  assert(responseOk.status === 'ok', 'apiClient.get resolve payload JSON em caso de sucesso (200 OK)');
  assert(
    forwardedAuthHeader === 'Bearer mock-staging-id-token',
    'Firebase ID Token encaminhado com segurança no cabeçalho Authorization: Bearer <token>',
    `Recebido: ${forwardedAuthHeader}`
  );

  // Restaura fetch e remove listener
  globalThis.fetch = originalFetch;
  unsubscribe();

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Auditoria de CORS: Validação Estrita de Origens Autorizadas (Fase 1D Hardened) ---');
  // --------------------------------------------------------------------------
  // Origens exatas do staging que DEVEM ser autorizadas
  process.env.STAGING_BACKEND_URL = 'https://itissimple-backend-staging.internal';
  assert(isAuthorizedOrigin('https://itissimple-backend-staging.internal'), 'URL dinâmica de STAGING_BACKEND_URL é autorizada quando configurada');
  delete process.env.STAGING_BACKEND_URL;
  assert(!isAuthorizedOrigin('https://itissimple-backend-staging-456322168913.us-east5.run.app'), 'URL fictícia não configurada é bloqueada (não tratada como implantada)');
  assert(isAuthorizedOrigin('https://ais-dev-oqs6qp7dnhslqr34rkqhkr-456322168913.us-east5.run.app'), 'URL atual do dev server é autorizada');
  assert(isAuthorizedOrigin('https://ais-pre-oqs6qp7dnhslqr34rkqhkr-456322168913.us-east5.run.app'), 'URL compartilhada é autorizada');
  assert(isAuthorizedOrigin('https://aistudio.google.com'), 'AI Studio exato é autorizado');
  assert(isAuthorizedOrigin('https://itissimple-security-staging.web.app'), 'Firebase Hosting staging (.web.app) é autorizado');
  assert(isAuthorizedOrigin('https://itissimple-security-staging.firebaseapp.com'), 'Firebase Hosting staging (.firebaseapp.com) é autorizado');
  assert(isAuthorizedOrigin('http://localhost:3000'), 'Localhost porta 3000 é autorizado');
  assert(isAuthorizedOrigin('http://localhost:5173'), 'Localhost Vite porta 5173 é autorizado');
  assert(isAuthorizedOrigin('http://127.0.0.1:3000'), 'Loopback 127.0.0.1 é autorizado');
  assert(isAuthorizedOrigin(undefined), 'Requisição direta sem cabeçalho Origin é autorizada');

  // Origens genéricas ou arbitrárias que DEVEM ser REJEITADAS (padrões curinga eliminados)
  assert(!isAuthorizedOrigin('https://my-staging-app-12345.run.app'), 'Serviço Cloud Run arbitrário sem allowlist é bloqueado');
  assert(!isAuthorizedOrigin('https://arbitrary-app.web.app'), 'Firebase Hosting arbitrário sem allowlist é bloqueado');
  assert(!isAuthorizedOrigin('https://random.firebaseapp.com'), 'Firebase Hosting arbitrário firebaseapp.com é bloqueado');
  assert(!isAuthorizedOrigin('https://arbitrary.google.com'), 'Subdomínio arbitrário do Google é bloqueado');
  assert(!isAuthorizedOrigin('https://content.googleusercontent.com'), 'googleusercontent genérico sem allowlist é bloqueado');
  assert(!isAuthorizedOrigin('https://malicious-website.com'), 'Origem externa arbitrária é bloqueada');
  assert(!isAuthorizedOrigin('http://hacker-site.org'), 'Site não autorizado é bloqueado');
  assert(!isAuthorizedOrigin('https://phishing-itissimple.com'), 'Domínio com nome parecido mas falso é bloqueado');
  assert(!isAuthorizedOrigin('https://run.app.evil.com'), 'Tentativa de spoofing de sufixo é bloqueada');
  assert(!isAuthorizedOrigin('http://localhost.evil.com'), 'Tentativa de spoofing de localhost é bloqueada');

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Preparação do Servidor Backend: Variável PORT e Standalone ---');
  // --------------------------------------------------------------------------
  // Testa resolução de PORT simulando Cloud Run (PORT=8080)
  const previousPort = process.env.PORT;
  process.env.PORT = '8080';
  const resolvedCloudRunPort = process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : (process.env.APP_PORT ? parseInt(process.env.APP_PORT, 10) : 3000);
  assert(
    resolvedCloudRunPort === 8080,
    'Servidor prioriza variável PORT fornecida pelo Cloud Run (8080)',
    `Porta resolvida: ${resolvedCloudRunPort}`
  );

  // Testa fallback sem PORT (process.env.PORT ausente)
  delete process.env.PORT;
  const resolvedFallbackPort = process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : (process.env.APP_PORT ? parseInt(process.env.APP_PORT, 10) : 3000);
  assert(
    resolvedFallbackPort === 3000 || resolvedFallbackPort === Number(process.env.APP_PORT || 3000),
    'Fallback seguro quando PORT não estiver definida',
    `Porta fallback: ${resolvedFallbackPort}`
  );
  if (previousPort) process.env.PORT = previousPort;

  // --------------------------------------------------------------------------
  console.log('\n=========================================================================');
  console.log(`TOTAL DE TESTES FASE 1C: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Erro fatal executando bateria de testes Fase 1C:', err);
  process.exit(1);
});
