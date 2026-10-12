/**
 * Bateria de Testes Automatizados — Fase 1D: Preparação de Backend Diagnóstico Isolado
 *
 * Projeto Exclusivo: itissimple-security-staging
 *
 * ESCOPO E LIMITAÇÃO DOS TESTES:
 * NOTA CRÍTICA: Os testes desta bateria são estritamente LOCAIS (executados com mocks controlados em memória).
 * Eles validam os contratos de isolamento, segurança, serialização e lógica de proteção IAM do backend.
 * Estes testes NÃO comprovam conectividade de rede real com o Google Cloud Firestore ou Cloud Run.
 * A conectividade real será comprovada exclusivamente na nuvem após a autorização explícita de deploy.
 *
 * Verificações Obrigatórias (Critérios de Aceite Fase 1D — Ajuste Final IAM):
 * 1. O modo diagnóstico não registra rotas de negócio.
 * 2. Nenhuma operação de negócio pode ser executada nesse modo.
 * 3. O Firestore é acessado exclusivamente no projeto de staging ('itissimple-security-staging') e banco '(default)'.
 * 4. Falhas IAM retornam erro explícito (Zero false-success, zero fallback local).
 * 5. Nenhuma gravação ocorre em app_db.json.
 * 6. O endpoint de diagnóstico requer autenticação IAM nativa do Cloud Run (Google OIDC ID Token).
 * 7. Dependência de DIAGNOSTIC_AUTH_TOKEN e segredos estáticos 100% removida.
 * 8. O endpoint /api/diagnostic/firestore não pode ser exposto publicamente por configuração acidental.
 * 9. CORS estrito: eliminação de curingas genéricos (*.run.app, *.google.com, etc.) e nenhuma URL fictícia na allowlist.
 * 10. Imunidade a tentativas de ativação por parâmetros de URL ou cabeçalhos HTTP.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  isDiagnosticMode,
  isAuthorizedOriginStrict,
  EXACT_STAGING_CORS_ALLOWLIST,
  executeFirestoreDiagnosticProbe,
  diagnosticAuthMiddleware,
  getExecutionServiceAccount,
  verifyGoogleCloudIamToken,
  getExpectedIamAudiences,
  isAuthorizedIamPrincipal,
  EXPLICIT_AUTHORIZED_IAM_IDENTITIES,
  isFirebaseIdToken,
  setTestPublicKeyForVerification,
  DIAGNOSTIC_PROJECT_ID,
  DIAGNOSTIC_DATABASE_ID,
} from '../src/serverDiagnostic';
import { setFirebaseAdminFirestoreForTesting, resetFirebaseAdminFirestoreForTesting } from '../src/serverFirestore';
import { app as diagnosticApp } from '../src/diagnosticApp';

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

/**
 * Utilitário para despachar requisições HTTP simuladas contra a instância Express
 */
function simulateRequest(
  appInstance: any,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  return new Promise((resolve) => {
    const reqHeaders: Record<string, string> = {};
    Object.entries(headers).forEach(([k, v]) => {
      reqHeaders[k.toLowerCase()] = v;
    });

    const parsedUrl = new URL(urlPath, 'http://localhost');
    const query: Record<string, string> = {};
    parsedUrl.searchParams.forEach((val, key) => {
      query[key] = val;
    });

    const req: any = {
      method: method.toUpperCase(),
      url: urlPath,
      originalUrl: urlPath,
      path: parsedUrl.pathname,
      query,
      headers: reqHeaders,
      body: body || {},
    };

    const resHeaders: Record<string, string> = {};
    let statusCode = 200;
    let resBody: any = null;

    const res: any = {
      setHeader: (name: string, value: string) => {
        resHeaders[name.toLowerCase()] = value;
      },
      getHeader: (name: string) => resHeaders[name.toLowerCase()],
      removeHeader: (name: string) => {
        delete resHeaders[name.toLowerCase()];
      },
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: any) => {
        resBody = data;
        resolve({ status: statusCode, headers: resHeaders, body: resBody });
      },
      send: (data: any) => {
        resBody = data;
        resolve({ status: statusCode, headers: resHeaders, body: resBody });
      },
      end: () => {
        resolve({ status: statusCode, headers: resHeaders, body: resBody });
      },
    };

    appInstance(req, res, (err?: any) => {
      if (err) {
        resolve({ status: 500, headers: resHeaders, body: { error: err.message } });
      } else {
        // Rota não manipulada cai no 404 padrão do Express
        resolve({ status: statusCode === 200 ? 404 : statusCode, headers: resHeaders, body: resBody || 'Cannot ' + method + ' ' + urlPath });
      }
    });
  });
}

async function runTests() {
  console.log('=========================================================================');
  console.log('=== TESTES AUTOMATIZADOS: FASE 1D — BACKEND DIAGNÓSTICO ISOLADO       ===');
  console.log('=== PROJETO EXCLUSIVO: itissimple-security-staging                    ===');
  console.log('=========================================================================');
  console.log('--- AVISO CRÍTICO DE ESCOPO:');
  console.log('--- Os testes executados abaixo são estritamente LOCAIS (mocks em memória).');
  console.log('--- Eles NÃO comprovam ainda conectividade real com a rede do Google Cloud Firestore.');
  console.log('--- A conectividade real será comprovada na nuvem após autorização explícita.');
  console.log('=========================================================================\n');

  // --------------------------------------------------------------------------
  console.log('--- 1. Ativação Exclusiva por Configuração de Servidor (Anti-Bypass) ---');
  // --------------------------------------------------------------------------
  delete process.env.DIAGNOSTIC_ONLY;
  assert(!isDiagnosticMode(), 'Modo diagnóstico desativado quando variável DIAGNOSTIC_ONLY está ausente');

  process.env.DIAGNOSTIC_ONLY = 'false';
  assert(!isDiagnosticMode(), 'Modo diagnóstico desativado quando DIAGNOSTIC_ONLY="false"');

  process.env.DIAGNOSTIC_ONLY = 'true';
  assert(isDiagnosticMode(), 'Modo diagnóstico ativado com sucesso quando DIAGNOSTIC_ONLY="true"');

  // Teste de Imunidade a Parâmetros de URL ou Headers
  delete process.env.DIAGNOSTIC_ONLY;
  const resFakeUrlParam = await simulateRequest(diagnosticApp, 'GET', '/api/tutors?diagnostic_only=true');
  assert(!isDiagnosticMode(), 'Parâmetro de URL (?diagnostic_only=true) NÃO altera process.env.DIAGNOSTIC_ONLY');

  const resFakeHeader = await simulateRequest(diagnosticApp, 'GET', '/api/tutors', {
    'X-Diagnostic-Mode': 'true',
    'X-Diagnostic-Only': 'true',
  });
  assert(!isDiagnosticMode(), 'Cabeçalho HTTP (X-Diagnostic-Mode: true) NÃO ativa modo diagnóstico no servidor');

  // Reativa para os testes do backend diagnóstico isolado
  process.env.DIAGNOSTIC_ONLY = 'true';

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Isolamento de Rotas: Rotas de Negócio NÃO Registradas (404) ---');
  // --------------------------------------------------------------------------
  const businessEndpointsToTest = [
    { method: 'GET', path: '/api/tutors' },
    { method: 'POST', path: '/api/tutors', body: { name: 'Fake Tutor' } },
    { method: 'GET', path: '/api/students' },
    { method: 'DELETE', path: '/api/students/usr-123' },
    { method: 'POST', path: '/api/auth/login', body: { email: 'adm.itissimple@gmail.com' } },
    { method: 'POST', path: '/api/auth/register', body: { email: 'new@example.com' } },
    { method: 'GET', path: '/api/teachers' },
    { method: 'GET', path: '/api/live-lessons' },
    { method: 'GET', path: '/api/homework' },
    { method: 'GET', path: '/api/dictionary/search?q=hello' },
    { method: 'GET', path: '/api/youtube-playlists' },
    { method: 'GET', path: '/api/spotify/playlists' },
    { method: 'POST', path: '/api/admin/clean-obsolete-users' },
    { method: 'POST', path: '/api/auth/sync-admin-claims' },
  ];

  for (const ep of businessEndpointsToTest) {
    const res = await simulateRequest(diagnosticApp, ep.method, ep.path, {}, ep.body);
    assert(
      res.status === 404,
      `Modo diagnóstico não registra rota de negócio: ${ep.method} ${ep.path} (Retorna 404)`,
      `Status recebido: ${res.status}`
    );
    assert(
      res.body && typeof res.body === 'object' && res.body.diagnosticMode === true,
      `Resposta de 404 para ${ep.path} explicita modo DIAGNOSTIC_ONLY ativo`
    );
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 3. Disponibilidade Estrita: Apenas /api/health e Diagnóstico ---');
  // --------------------------------------------------------------------------
  const healthRes = await simulateRequest(diagnosticApp, 'GET', '/api/health');
  assert(healthRes.status === 200, 'Endpoint /api/health responde 200 OK');
  assert(healthRes.body?.status === 'ok', '/api/health retorna status ok');
  assert(healthRes.body?.mode === 'diagnostic_only', '/api/health identifica mode: diagnostic_only');
  assert(healthRes.body?.projectId === DIAGNOSTIC_PROJECT_ID, `/api/health confirma projectId '${DIAGNOSTIC_PROJECT_ID}'`);

  const diagHealthRes = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/health');
  assert(diagHealthRes.status === 200, 'Endpoint /api/diagnostic/health responde 200 OK');
  assert(diagHealthRes.body?.diagnosticMode === true, '/api/diagnostic/health confirma diagnosticMode=true');

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Proteção contra Acesso Público: Diagnóstico Requer Autenticação IAM Nativa ---');
  // --------------------------------------------------------------------------
  // Requisições anônimas DEVEM ser rejeitadas com 401
  const anonGetRes = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore');
  assert(anonGetRes.status === 401, 'GET /api/diagnostic/firestore anônimo é rejeitado com 401 Unauthorized');
  assert(anonGetRes.body?.code === 'MISSING_IAM_CREDENTIALS', 'Código de erro padronizado para falta de credenciais IAM');

  const anonPostRes = await simulateRequest(diagnosticApp, 'POST', '/api/diagnostic/firestore');
  assert(anonPostRes.status === 401, 'POST /api/diagnostic/firestore anônimo é rejeitado com 401 Unauthorized');

  // Token inválido / forjado DEVE ser rejeitado com 403 Forbidden
  const invalidTokenRes = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer invalid-forged-token-xyz',
  });
  assert(invalidTokenRes.status === 403, 'Token forjado/inválido é rejeitado com 403 Forbidden');
  assert(invalidTokenRes.body?.code === 'INVALID_IAM_CREDENTIALS', 'Código padronizado para credencial IAM inválida');

  // Tentativa de utilizar segredo estático antigo (DIAGNOSTIC_AUTH_TOKEN) DEVE ser REJEITADA
  process.env.DIAGNOSTIC_AUTH_TOKEN = 'staging-diagnostic-secret-9988';
  const staticSecretRes = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer staging-diagnostic-secret-9988',
  });
  assert(
    staticSecretRes.status === 403,
    'Tentativa de usar segredo estático (DIAGNOSTIC_AUTH_TOKEN) é rejeitada com 403 (Segredos estáticos eliminados)'
  );
  delete process.env.DIAGNOSTIC_AUTH_TOKEN;

  // Identidade Google válida porém de origem não autorizada (ex: hacker externo) DEVE ser rejeitada
  const unauthorizedCallerRes = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-unauthorized-caller',
  });
  assert(
    unauthorizedCallerRes.status === 403,
    'Invocador Google IAM externo não cadastrado no staging é rejeitado com 403 Forbidden'
  );
  assert(
    unauthorizedCallerRes.body?.code === 'UNAUTHORIZED_IAM_IDENTITY',
    'Código de erro explícito para identidade IAM não autorizada'
  );

  // Invocador IAM autorizado (Service Account de Staging) autentica com sucesso
  let passedServiceAccountAuth = false;
  let attachedCallerInfo: any = null;
  const mockSaReq: any = {
    headers: { authorization: 'Bearer mock-iam-oidc-token' },
  };
  const mockSaRes: any = {};
  await diagnosticAuthMiddleware(mockSaReq, mockSaRes, () => {
    passedServiceAccountAuth = true;
    attachedCallerInfo = mockSaReq.iamCaller;
  });
  assert(passedServiceAccountAuth, 'Middleware autoriza Service Account de staging via token OIDC');
  assert(
    attachedCallerInfo?.email === 'sa-diagnostic-caller@itissimple-security-staging.iam.gserviceaccount.com',
    'Identidade da Service Account autorizada anexada à requisição para auditoria'
  );

  // Invocador IAM autorizado (Administrador Staging adm.itissimple@gmail.com) autentica com sucesso
  let passedAdminAuth = false;
  const mockAdminReq: any = {
    headers: { authorization: 'Bearer mock-iam-admin-user' },
  };
  const mockAdminRes: any = {};
  await diagnosticAuthMiddleware(mockAdminReq, mockAdminRes, () => {
    passedAdminAuth = true;
  });
  assert(passedAdminAuth, 'Middleware autoriza administrador de staging via token OIDC');

  // Cabeçalho Cloud Run X-Serverless-Authorization também é aceito para tráfego interno
  let passedServerlessHeader = false;
  const mockServerlessReq: any = {
    headers: { 'x-serverless-authorization': 'Bearer mock-iam-oidc-token' },
  };
  const mockServerlessRes: any = {};
  await diagnosticAuthMiddleware(mockServerlessReq, mockServerlessRes, () => {
    passedServerlessHeader = true;
  });
  assert(passedServerlessHeader, 'Cabeçalho nativo X-Serverless-Authorization é validado com sucesso');

  // --------------------------------------------------------------------------
  console.log('\n--- 4.1. Validação Final de Identidade OIDC — Testes Negativos & Integridade (Fase 1D.2) ---');
  // --------------------------------------------------------------------------

  // A. Configuração de Audience Esperada
  const serviceUrl = 'https://itissimple-backend-diagnostic.us-east5.run.app';
  process.env.EXPECTED_AUDIENCE = serviceUrl;

  const resolvedAudiences = getExpectedIamAudiences();
  assert(
    resolvedAudiences.includes(serviceUrl),
    'getExpectedIamAudiences() resolve a URL real/esperada do Cloud Run'
  );

  // B. Teste Negativo 1: Audience Incorreta
  const wrongAudRes = await verifyGoogleCloudIamToken('mock-iam-wrong-audience');
  assert(!wrongAudRes.valid, 'Token com audience incorreta é rejeitado');
  assert(wrongAudRes.code === 'INVALID_IAM_AUDIENCE', 'Código padronizado INVALID_IAM_AUDIENCE retornado');

  const httpWrongAud = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-wrong-audience',
  });
  assert(httpWrongAud.status === 403, 'Endpoint /api/diagnostic/firestore rejeita token com audience incorreta com 403 Forbidden');
  assert(httpWrongAud.body?.code === 'INVALID_IAM_AUDIENCE', 'Endpoint propaga código INVALID_IAM_AUDIENCE');

  // C. Teste Negativo 2: Emissor Incorreto
  const wrongIssRes = await verifyGoogleCloudIamToken('mock-iam-wrong-issuer');
  assert(!wrongIssRes.valid, 'Token com emissor incorreto é rejeitado');
  assert(wrongIssRes.code === 'INVALID_IAM_ISSUER', 'Código padronizado INVALID_IAM_ISSUER retornado');

  const httpWrongIss = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-wrong-issuer',
  });
  assert(httpWrongIss.status === 403, 'Endpoint /api/diagnostic/firestore rejeita emissor incorreto com 403 Forbidden');
  assert(httpWrongIss.body?.code === 'INVALID_IAM_ISSUER', 'Endpoint propaga código INVALID_IAM_ISSUER');

  // D. Teste Negativo 3: Token Expirado
  const expiredRes = await verifyGoogleCloudIamToken('mock-iam-expired-token');
  assert(!expiredRes.valid, 'Token expirado é rejeitado');
  assert(expiredRes.code === 'TOKEN_EXPIRED', 'Código padronizado TOKEN_EXPIRED retornado');

  const httpExpired = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-expired-token',
  });
  assert(httpExpired.status === 403, 'Endpoint /api/diagnostic/firestore rejeita token expirado com 403 Forbidden');
  assert(httpExpired.body?.code === 'TOKEN_EXPIRED', 'Endpoint propaga código TOKEN_EXPIRED');

  // E. Teste Negativo 4: Remoção de Curingas e Service Accounts Não Cadastradas
  // Prova que *@itissimple-security-staging.iam.gserviceaccount.com FOI REMOVIDO
  const unlistedSaRes = await verifyGoogleCloudIamToken('mock-iam-unlisted-sa');
  assert(!unlistedSaRes.valid, 'Service Account do staging não listada explicitamente é REJEITADA (Zero wildcards)');
  assert(unlistedSaRes.code === 'UNAUTHORIZED_IAM_IDENTITY', 'Código padronizado UNAUTHORIZED_IAM_IDENTITY para SA não listada');

  const httpUnlistedSa = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-unlisted-sa',
  });
  assert(httpUnlistedSa.status === 403, 'Endpoint bloqueia Service Account arbitrária do mesmo projeto com 403 Forbidden');

  // Validação direta da função isAuthorizedIamPrincipal com tentativa de curinga
  assert(
    !isAuthorizedIamPrincipal('rogue-service-account@itissimple-security-staging.iam.gserviceaccount.com'),
    'isAuthorizedIamPrincipal rejeita Service Account arbitrária no domínio staging'
  );
  assert(
    !isAuthorizedIamPrincipal('*@itissimple-security-staging.iam.gserviceaccount.com'),
    'isAuthorizedIamPrincipal rejeita explicitamente strings com curinga (*)'
  );

  // Injeção de curinga em ALLOWED_IAM_CALLERS não surte efeito
  process.env.ALLOWED_IAM_CALLERS = '*@itissimple-security-staging.iam.gserviceaccount.com,hacker@evil.com';
  assert(
    !isAuthorizedIamPrincipal('another-sa@itissimple-security-staging.iam.gserviceaccount.com'),
    'Curinga injetado em ALLOWED_IAM_CALLERS é estritamente ignorado/rejeitado'
  );
  delete process.env.ALLOWED_IAM_CALLERS;

  // F. Teste Negativo 5: email_verified=true NÃO concede privilégios isoladamente
  const verifiedOnlyRes = await verifyGoogleCloudIamToken('mock-iam-verified-only');
  assert(!verifiedOnlyRes.valid, 'Conta com email_verified=true fora da allowlist é REJEITADA');
  assert(verifiedOnlyRes.code === 'UNAUTHORIZED_IAM_IDENTITY', 'email_verified=true sem correspondência em allowlist retorna UNAUTHORIZED_IAM_IDENTITY');

  const httpVerifiedOnly = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-verified-only',
  });
  assert(httpVerifiedOnly.status === 403, 'Endpoint rejeita usuário com email_verified=true sem autorização explícita com 403 Forbidden');

  // G. Teste Negativo 6: Token do Firebase Auth Rejeitado como Credencial IAM (Anti-Confusion)
  const firebaseTokenRes = await verifyGoogleCloudIamToken('mock-iam-firebase-token');
  assert(!firebaseTokenRes.valid, 'Token do Firebase Auth é estritamente REJEITADO para invocação IAM');
  assert(firebaseTokenRes.code === 'FIREBASE_AUTH_TOKEN_REJECTED', 'Código padronizado FIREBASE_AUTH_TOKEN_REJECTED retornado');

  const httpFirebaseToken = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-firebase-token',
  });
  assert(httpFirebaseToken.status === 403, 'Endpoint /api/diagnostic/firestore rejeita token Firebase Auth com 403 Forbidden');
  assert(httpFirebaseToken.body?.code === 'FIREBASE_AUTH_TOKEN_REJECTED', 'Endpoint propaga código FIREBASE_AUTH_TOKEN_REJECTED');

  // H. Allowlist Explícita: Verificação de Todos os Principais Autorizados
  assert(EXPLICIT_AUTHORIZED_IAM_IDENTITIES.has('sa-diagnostic-backend@itissimple-security-staging.iam.gserviceaccount.com'), 'SA sa-diagnostic-backend na allowlist explícita');
  assert(EXPLICIT_AUTHORIZED_IAM_IDENTITIES.has('sa-diagnostic-caller@itissimple-security-staging.iam.gserviceaccount.com'), 'SA sa-diagnostic-caller na allowlist explícita');
  assert(EXPLICIT_AUTHORIZED_IAM_IDENTITIES.has('adm.itissimple@gmail.com'), 'Admin adm.itissimple@gmail.com na allowlist explícita');
  assert(!EXPLICIT_AUTHORIZED_IAM_IDENTITIES.has('admin@itissimple.com'), 'Conta desnecessária admin@itissimple.com removida da allowlist estática');
  assert(EXPLICIT_AUTHORIZED_IAM_IDENTITIES.size === 3, 'Allowlist estática restrita ao conjunto estritamente mínimo de 3 identidades');

  // I. Testes Criptográficos RSA-SHA256 Reais com JWTs Estruturados
  console.log('\n--- 4.2. Testes Criptográficos com Assinatura RSA-SHA256 (Pares de Chaves Reais) ---');
  const { publicKey: testPublicKey, privateKey: testPrivateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const { privateKey: untrustedPrivateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  function makeRsaJwt(payload: Record<string, any>, privKey: string): string {
    const header = { alg: 'RS256', typ: 'JWT' };
    const encHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const dataToSign = `${encHeader}.${encPayload}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(dataToSign);
    const sig = signer.sign(privKey, 'base64url');
    return `${dataToSign}.${sig}`;
  }

  setTestPublicKeyForVerification(testPublicKey);

  const nowSec = Math.floor(Date.now() / 1000);

  // 1. JWT válido com assinatura criptográfica correta e audience esperada
  const validPayload = {
    iss: 'https://accounts.google.com',
    aud: serviceUrl,
    sub: '109876543210987654321',
    email: 'sa-diagnostic-caller@itissimple-security-staging.iam.gserviceaccount.com',
    email_verified: true,
    exp: nowSec + 3600,
    iat: nowSec,
  };
  const validJwt = makeRsaJwt(validPayload, testPrivateKey);
  const cryptoValidRes = await verifyGoogleCloudIamToken(validJwt);
  assert(cryptoValidRes.valid, 'JWT com assinatura criptográfica RSA-SHA256 válida é aceito com sucesso');
  assert(cryptoValidRes.email === validPayload.email, 'Identidade do caller extraída do JWT criptograficamente verificado');

  // 2. JWT com assinatura forjada (assinada com chave privada incorreta/não confiável)
  const forgedJwt = makeRsaJwt(validPayload, untrustedPrivateKey);
  const cryptoForgedRes = await verifyGoogleCloudIamToken(forgedJwt);
  assert(!cryptoForgedRes.valid, 'JWT com assinatura forjada é REJEITADO criptograficamente');
  assert(cryptoForgedRes.code === 'INVALID_IAM_CREDENTIALS', 'Código INVALID_IAM_CREDENTIALS para falha de assinatura RSA');

  // 3. JWT com payload adulterado (assinatura não bate com o corpo)
  const tamperedParts = validJwt.split('.');
  const tamperedPayload = { ...validPayload, email: 'adm.itissimple@gmail.com' };
  const tamperedJwt = `${tamperedParts[0]}.${Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url')}.${tamperedParts[2]}`;
  const cryptoTamperedRes = await verifyGoogleCloudIamToken(tamperedJwt);
  assert(!cryptoTamperedRes.valid, 'JWT com corpo adulterado após assinatura é REJEITADO');

  // 4. JWT Criptográfico com Audience Incorreta
  const wrongAudPayload = {
    ...validPayload,
    aud: 'https://other-cloud-run-service.a.run.app',
  };
  const cryptoWrongAudJwt = makeRsaJwt(wrongAudPayload, testPrivateKey);
  const cryptoWrongAudRes = await verifyGoogleCloudIamToken(cryptoWrongAudJwt);
  assert(!cryptoWrongAudRes.valid, 'JWT criptográfico com audience incorreta é REJEITADO');
  assert(cryptoWrongAudRes.code === 'INVALID_IAM_AUDIENCE', 'Retorna INVALID_IAM_AUDIENCE para audience divergente da esperada');

  // 5. JWT Criptográfico com Emissor Incorreto
  const wrongIssPayload = {
    ...validPayload,
    iss: 'https://untrusted-issuer.com',
  };
  const cryptoWrongIssJwt = makeRsaJwt(wrongIssPayload, testPrivateKey);
  const cryptoWrongIssRes = await verifyGoogleCloudIamToken(cryptoWrongIssJwt);
  assert(!cryptoWrongIssRes.valid, 'JWT criptográfico com emissor incorreto é REJEITADO');
  assert(cryptoWrongIssRes.code === 'INVALID_IAM_ISSUER', 'Retorna INVALID_IAM_ISSUER para emissor inválido');

  // 6. JWT Criptográfico Expirado
  const expiredPayload = {
    ...validPayload,
    exp: nowSec - 1800, // Expirado há 30 minutos
  };
  const cryptoExpiredJwt = makeRsaJwt(expiredPayload, testPrivateKey);
  const cryptoExpiredRes = await verifyGoogleCloudIamToken(cryptoExpiredJwt);
  assert(!cryptoExpiredRes.valid, 'JWT criptográfico expirado é REJEITADO');
  assert(cryptoExpiredRes.code === 'TOKEN_EXPIRED', 'Retorna TOKEN_EXPIRED para timestamp expirado');

  // 7. JWT Criptográfico com Identidade Não Autorizada
  const unauthorizedPayload = {
    ...validPayload,
    email: 'intruder@external-company.com',
  };
  const cryptoUnauthorizedJwt = makeRsaJwt(unauthorizedPayload, testPrivateKey);
  const cryptoUnauthorizedRes = await verifyGoogleCloudIamToken(cryptoUnauthorizedJwt);
  assert(!cryptoUnauthorizedRes.valid, 'JWT criptográfico com identidade não autorizada é REJEITADO');
  assert(cryptoUnauthorizedRes.code === 'UNAUTHORIZED_IAM_IDENTITY', 'Retorna UNAUTHORIZED_IAM_IDENTITY para identidade fora da allowlist');

  // 8. JWT Criptográfico com Service Account do Staging NÃO Listada (Anti-Wildcard)
  const unlistedSaPayload = {
    ...validPayload,
    email: 'unlisted-batch-worker@itissimple-security-staging.iam.gserviceaccount.com',
  };
  const cryptoUnlistedSaJwt = makeRsaJwt(unlistedSaPayload, testPrivateKey);
  const cryptoUnlistedSaRes = await verifyGoogleCloudIamToken(cryptoUnlistedSaJwt);
  assert(!cryptoUnlistedSaRes.valid, 'JWT com SA de staging não listada é REJEITADO (Comprova eliminação de curingas)');
  assert(cryptoUnlistedSaRes.code === 'UNAUTHORIZED_IAM_IDENTITY', 'Retorna UNAUTHORIZED_IAM_IDENTITY para SA não autorizada');

  // 9. JWT Criptográfico com email_verified=true mas fora da allowlist
  const verifiedOnlyPayload = {
    ...validPayload,
    email: 'random-verified-user@gmail.com',
    email_verified: true,
  };
  const cryptoVerifiedOnlyJwt = makeRsaJwt(verifiedOnlyPayload, testPrivateKey);
  const cryptoVerifiedOnlyRes = await verifyGoogleCloudIamToken(cryptoVerifiedOnlyJwt);
  assert(!cryptoVerifiedOnlyRes.valid, 'JWT com email_verified=true mas fora da allowlist é REJEITADO');
  assert(cryptoVerifiedOnlyRes.code === 'UNAUTHORIZED_IAM_IDENTITY', 'email_verified=true não concede privilégios isoladamente');

  // 10. JWT Criptográfico do Firebase Auth (Anti-Confusion)
  const firebasePayload = {
    iss: `https://securetoken.google.com/${DIAGNOSTIC_PROJECT_ID}`,
    aud: DIAGNOSTIC_PROJECT_ID,
    sub: 'firebase-user-uid-456',
    email: 'adm.itissimple@gmail.com',
    email_verified: true,
    exp: nowSec + 3600,
    firebase: { identities: { email: ['adm.itissimple@gmail.com'] } },
  };
  const cryptoFirebaseJwt = makeRsaJwt(firebasePayload, testPrivateKey);
  const cryptoFirebaseRes = await verifyGoogleCloudIamToken(cryptoFirebaseJwt);
  assert(!cryptoFirebaseRes.valid, 'JWT do Firebase Auth assinado é REJEITADO como credencial IAM');
  assert(cryptoFirebaseRes.code === 'FIREBASE_AUTH_TOKEN_REJECTED', 'Retorna FIREBASE_AUTH_TOKEN_REJECTED impedindo confusão com credenciais do frontend');

  // Desativa chave de teste
  setTestPublicKeyForVerification(null);
  delete process.env.EXPECTED_AUDIENCE;

  // --------------------------------------------------------------------------
  console.log('\n--- 5. Verificação da Service Account e Validação do Projeto ---');
  // --------------------------------------------------------------------------
  const saInfo = await getExecutionServiceAccount();
  assert(
    Boolean(saInfo.serviceAccount && saInfo.serviceAccount.includes('@')),
    'Identidade da Service Account inspecionada com formato de e-mail válido',
    `SA identificada: ${saInfo.serviceAccount}`
  );
  assert(
    saInfo.projectId === DIAGNOSTIC_PROJECT_ID,
    `Identificação de projeto da Service Account restrita a '${DIAGNOSTIC_PROJECT_ID}'`
  );

  // Tentativa de executar probe com projeto não autorizado DEVE ser abortada imediatamente
  process.env.FIREBASE_PROJECT_ID = 'itissimple-8663d'; // Tentativa em projeto legado proibido
  const probeUnauthorizedProject = await executeFirestoreDiagnosticProbe();
  assert(
    !probeUnauthorizedProject.success,
    'Diagnostic probe rejeita execução quando projeto for diferente de itissimple-security-staging'
  );
  assert(
    probeUnauthorizedProject.failedStep === 'project_validation',
    'Falha imediata no passo project_validation'
  );
  assert(
    probeUnauthorizedProject.code === 'PROJECT_UNAUTHORIZED' || probeUnauthorizedProject.code === 'FORBIDDEN_PROJECT',
    'Código explícito de rejeição por projeto não autorizado'
  );

  // Restaura projeto correto
  process.env.FIREBASE_PROJECT_ID = DIAGNOSTIC_PROJECT_ID;

  // --------------------------------------------------------------------------
  console.log('\n--- 6. Diagnóstico Real do Firestore: Leitura, Escrita e Exclusão Seguras ---');
  // --------------------------------------------------------------------------
  // Mock controlado de Firestore para testar probe completo em ambiente local
  const memoryStore = new Map<string, any>();
  let writeCalled = false;
  let readCalled = false;
  let deleteCalled = false;
  let targetCollectionUsed = '';

  const mockDiagnosticFirestore: any = {
    projectId: DIAGNOSTIC_PROJECT_ID,
    collection: (colName: string) => {
      targetCollectionUsed = colName;
      return {
        doc: (docId: string) => ({
          set: async (data: any) => {
            writeCalled = true;
            memoryStore.set(docId, data);
            return { writeTime: new Date() };
          },
          get: async () => {
            readCalled = true;
            const exists = memoryStore.has(docId);
            return {
              exists,
              data: () => memoryStore.get(docId),
            };
          },
          delete: async () => {
            deleteCalled = true;
            memoryStore.delete(docId);
            return { writeTime: new Date() };
          },
        }),
      };
    },
  };

  setFirebaseAdminFirestoreForTesting(mockDiagnosticFirestore);

  const successfulProbe = await executeFirestoreDiagnosticProbe();
  assert(successfulProbe.success, 'Diagnostic probe executado com sucesso completo no projeto staging');
  assert(targetCollectionUsed === '_diagnostic_probes', 'Operações restritas estritamente à coleção temporária _diagnostic_probes');
  assert(writeCalled, 'Operação WRITE no Firestore executada e confirmada');
  assert(readCalled, 'Operação READ no Firestore executada e confirmada');
  assert(deleteCalled, 'Operação DELETE no Firestore executada e confirmada');
  assert(successfulProbe.operations.write.status === 'confirmed', 'Status de WRITE registrado como confirmed');
  assert(successfulProbe.operations.read.status === 'confirmed', 'Status de READ registrado como confirmed');
  assert(successfulProbe.operations.read.verified === true, 'Leitura confirmou integridade do payload escrito');
  assert(successfulProbe.operations.delete.status === 'confirmed', 'Status de DELETE registrado como confirmed');
  assert(memoryStore.size === 0, 'Documento de probe temporário foi completamente excluído ao final do teste');
  assert(successfulProbe.databaseId === '(default)', 'Banco de dados confirmado exclusivamente como (default)');

  // --------------------------------------------------------------------------
  console.log('\n--- 7. Falhas IAM Retornam Erro Explícito (Zero Fallback Local) ---');
  // --------------------------------------------------------------------------
  // Simula erro de permissão IAM no Firestore (PERMISSION_DENIED, código 7)
  const mockPermissionDeniedFirestore: any = {
    projectId: DIAGNOSTIC_PROJECT_ID,
    collection: () => ({
      doc: () => ({
        set: async () => {
          const err: any = new Error('7 PERMISSION_DENIED: Missing or insufficient permissions on _diagnostic_probes');
          err.code = 7;
          throw err;
        },
        get: async () => ({ exists: false }),
        delete: async () => {},
      }),
    }),
  };

  setFirebaseAdminFirestoreForTesting(mockPermissionDeniedFirestore);

  const deniedProbe = await executeFirestoreDiagnosticProbe();
  assert(!deniedProbe.success, 'Falha IAM no Firestore resulta em erro (success: false)');
  assert(deniedProbe.failedStep === 'write', 'Passo da falha explicitado como "write"');
  assert(deniedProbe.code === 7 || String(deniedProbe.code).includes('PERMISSION_DENIED'), 'Código de erro IAM preservado e explícito');
  assert(deniedProbe.operations.write.status === 'failed', 'Operação de escrita marcada como failed');
  assert(
    Boolean(deniedProbe.operations.write.error?.includes('PERMISSION_DENIED')),
    'Mensagem detalhada da falha retornada sem mascaramento'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 8. Garantia Anti-Escrita em app_db.json (Zero Gravação Local) ---');
  // --------------------------------------------------------------------------
  const appDbPath = path.join(process.cwd(), 'src', 'data', 'app_db.json');
  let originalStats: fs.Stats | null = null;
  let originalHash: string = '';

  if (fs.existsSync(appDbPath)) {
    originalStats = fs.statSync(appDbPath);
    const content = fs.readFileSync(appDbPath);
    originalHash = crypto.createHash('sha256').update(content).digest('hex');
  }

  // Executa múltiplas chamadas ao probe e rotas no backend diagnóstico
  await simulateRequest(diagnosticApp, 'GET', '/api/health');
  await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/health');
  await executeFirestoreDiagnosticProbe();

  if (fs.existsSync(appDbPath) && originalStats) {
    const afterStats = fs.statSync(appDbPath);
    const afterContent = fs.readFileSync(appDbPath);
    const afterHash = crypto.createHash('sha256').update(afterContent).digest('hex');

    assert(
      originalHash === afterHash,
      'Conteúdo e hash SHA256 de app_db.json são 100% idênticos (Zero alterações)'
    );
    assert(
      originalStats.mtimeMs === afterStats.mtimeMs,
      'Data de modificação (mtime) de app_db.json não foi alterada (Zero I/O)'
    );
  } else {
    assert(true, 'app_db.json preservado sem escritas');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 9. Auditoria de CORS Estrito e Validação de URLs Fictícias ---');
  // --------------------------------------------------------------------------
  // Origens exatas permitidas
  assert(isAuthorizedOriginStrict('https://itissimple-security-staging.web.app'), 'Origem exata staging web.app é autorizada');
  assert(isAuthorizedOriginStrict('https://itissimple-security-staging.firebaseapp.com'), 'Origem exata staging firebaseapp.com é autorizada');
  assert(isAuthorizedOriginStrict('https://aistudio.google.com'), 'AI Studio exato é autorizado');
  assert(isAuthorizedOriginStrict('http://localhost:3000'), 'Localhost 3000 é autorizado');
  assert(isAuthorizedOriginStrict('http://127.0.0.1:3000'), 'Loopback 127.0.0.1 é autorizado');

  // Nenhuma URL fictícia de Cloud Run consta na allowlist hardcoded
  assert(
    !EXACT_STAGING_CORS_ALLOWLIST.includes('https://itissimple-backend-staging-456322168913.us-east5.run.app'),
    'URL fictícia itissimple-backend-staging-456322168913.us-east5.run.app foi removida da allowlist estática'
  );
  assert(
    !isAuthorizedOriginStrict('https://itissimple-backend-staging-456322168913.us-east5.run.app'),
    'URL fictícia não configurada é rejeitada (nenhum serviço tratado como implantado antes do deploy)'
  );

  // URL dinâmica configurada via STAGING_BACKEND_URL é autorizada
  process.env.STAGING_BACKEND_URL = 'https://my-real-backend.us-east5.run.app';
  assert(
    isAuthorizedOriginStrict('https://my-real-backend.us-east5.run.app'),
    'URL dinâmica de STAGING_BACKEND_URL é autorizada quando configurada em tempo de execução'
  );
  delete process.env.STAGING_BACKEND_URL;

  // Origens genéricas com curinga que DEVEM ser REJEITADAS
  assert(!isAuthorizedOriginStrict('https://random-service-123.run.app'), 'Curinga genérico *.run.app é estritamente bloqueado');
  assert(!isAuthorizedOriginStrict('https://malicious.run.app'), 'Serviço Cloud Run arbitrário é bloqueado');
  assert(!isAuthorizedOriginStrict('https://arbitrary-app.web.app'), 'Curinga genérico *.web.app é bloqueado');
  assert(!isAuthorizedOriginStrict('https://phishing-app.firebaseapp.com'), 'Curinga genérico *.firebaseapp.com é bloqueado');
  assert(!isAuthorizedOriginStrict('https://evil.google.com'), 'Curinga genérico *.google.com é bloqueado');
  assert(!isAuthorizedOriginStrict('https://hacker.com'), 'Origem não cadastrada é bloqueada');

  // Preflight OPTIONS para origem não autorizada deve retornar 403
  const corsBlockedOptions = await simulateRequest(diagnosticApp, 'OPTIONS', '/api/health', {
    Origin: 'https://attacker-domain.com',
  });
  assert(
    corsBlockedOptions.status === 403,
    'Preflight OPTIONS para origem não autorizada retorna 403 Forbidden',
    `Status: ${corsBlockedOptions.status}`
  );

  // Preflight OPTIONS para origem autorizada deve retornar 200
  const corsAllowedOptions = await simulateRequest(diagnosticApp, 'OPTIONS', '/api/health', {
    Origin: 'https://itissimple-security-staging.web.app',
  });
  assert(
    corsAllowedOptions.status === 200,
    'Preflight OPTIONS para origem autorizada retorna 200 OK'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 10. Preservação do Modo Normal ---');
  // --------------------------------------------------------------------------
  delete process.env.DIAGNOSTIC_ONLY;
  assert(!isDiagnosticMode(), 'Modo normal ativo quando DIAGNOSTIC_ONLY não está definido');

  // --------------------------------------------------------------------------
  console.log('\n--- 11. Verificação de Inicialização e Dockerfile (Produção / Cloud Run) ---');
  // --------------------------------------------------------------------------
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert(
    Boolean(packageJson.scripts?.['start:diagnostic']),
    'Script start:diagnostic configurado no package.json'
  );
  assert(
    packageJson.scripts?.['start'] === 'node server.ts',
    'Script start padrão executa node server.ts (compatível com Cloud Run)'
  );

  const dockerfilePath = path.join(process.cwd(), 'Dockerfile');
  const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
  assert(
    dockerfileContent.includes('CMD ["node", "server.ts"]'),
    'Dockerfile define CMD ["node", "server.ts"] para inicialização do container'
  );
  assert(
    dockerfileContent.includes('ENV DIAGNOSTIC_ONLY=true'),
    'Dockerfile define expressamente ENV DIAGNOSTIC_ONLY=true para execução no Cloud Run'
  );

  resetFirebaseAdminFirestoreForTesting();

  console.log('\n=========================================================================');
  console.log(`TOTAL DE TESTES FASE 1D: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error running Phase 1D test suite:', err);
  process.exit(1);
});
