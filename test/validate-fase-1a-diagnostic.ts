/**
 * Bateria de Testes Automatizados — FASE 1A: Correção Controlada do Diagnóstico
 *
 * Projeto Exclusivo: itissimple-security-staging
 * Projeto Legado PROIBIDO: itissimple-8663d
 *
 * ESCOPO E AVISO OBRIGATÓRIO DE LIMITAÇÃO TÉCNICA (Critério 9):
 * Os testes desta bateria são estritamente LOCAIS (executados com mocks controlados em memória).
 * Eles validam os contratos de isolamento, segurança de cabeçalhos, validação criptográfica e lógica de sondagem.
 * ESTES TESTES NÃO SÃO E NÃO PODEM SER UTILIZADOS COMO PROVA DE CONECTIVIDADE REAL COM O GOOGLE CLOUD FIRESTORE.
 * A conectividade real será comprovada exclusivamente na nuvem (Cloud Shell / Cloud Run) após autorização humana explícita.
 *
 * Verificações Obrigatórias (Fase 1A):
 * 1. Substituição da sonda de escrita/leitura/exclusão por operação get() única no documento _diagnostic_probes/connectivity_check, banco (default).
 * 2. Verificação explícita de projeto (itissimple-security-staging) e banco ((default)) antes de qualquer operação.
 * 3. Resultados estruturados sem expor credenciais ou conteúdo do documento.
 * 4. Tratamento de cabeçalhos IAM conforme comportamento documentado do Cloud Run (rejeição de SIGNATURE_REMOVED_BY_GOOGLE).
 * 5. Validação criptográfica do token no Express sem confiar em claims simplesmente decodificadas.
 * 6. Proteção estrita do endpoint contra acesso anônimo (401).
 * 7. Bateria de testes para:
 *    a) Token ausente (401)
 *    b) Token inválido (403)
 *    c) Audiência incorreta (403)
 *    d) Identidade não autorizada (403)
 *    e) Erros de conectividade Firestore (403 / 503)
 * 8. Zero criação, modificação ou exclusão de documentos Firestore.
 * 9. Preservação de zero dados em app_db.json, zero localStorage, zero sessionStorage e zero IndexedDB persistente.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  isDiagnosticMode,
  executeFirestoreDiagnosticProbe,
  diagnosticAuthMiddleware,
  verifyGoogleCloudIamToken,
  getExpectedIamAudiences,
  isAuthorizedIamPrincipal,
  EXPLICIT_AUTHORIZED_IAM_IDENTITIES,
  isFirebaseIdToken,
  setTestPublicKeyForVerification,
  extractIamTokenFromHeaders,
  DIAGNOSTIC_PROJECT_ID,
  DIAGNOSTIC_DATABASE_ID,
  DIAGNOSTIC_COLLECTION,
  DIAGNOSTIC_DOCUMENT_ID,
  DIAGNOSTIC_DOCUMENT_PATH,
  setFirestoreDbResolverForTesting,
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
        resolve({
          status: statusCode === 200 ? 404 : statusCode,
          headers: resHeaders,
          body: resBody || 'Cannot ' + method + ' ' + urlPath,
        });
      }
    });
  });
}

async function runPhase1ATests() {
  console.log('=========================================================================');
  console.log('=== TESTES AUTOMATIZADOS: FASE 1A — CORREÇÃO CONTROLADA DO DIAGNÓSTICO ===');
  console.log('=== PROJETO EXCLUSIVO: itissimple-security-staging                    ===');
  console.log('=========================================================================');
  console.log('--- AVISO CRÍTICO DE ESCOPO (REGRA 9):');
  console.log('--- Os testes executados abaixo são estritamente LOCAIS (mocks em memória).');
  console.log('--- Eles NÃO COMPROVAM conectividade de rede real com o Google Cloud Firestore.');
  console.log('--- A conectividade real será comprovada na nuvem sob autorização humana explícita.');
  console.log('=========================================================================\n');

  // --------------------------------------------------------------------------
  console.log('--- 1. Constantes e Identificadores Fixos do Diagnóstico ---');
  // --------------------------------------------------------------------------
  assert(DIAGNOSTIC_PROJECT_ID === 'itissimple-security-staging', 'DIAGNOSTIC_PROJECT_ID fixado em itissimple-security-staging');
  assert(DIAGNOSTIC_DATABASE_ID === '(default)', 'DIAGNOSTIC_DATABASE_ID fixado em (default)');
  assert(DIAGNOSTIC_COLLECTION === '_diagnostic_probes', 'DIAGNOSTIC_COLLECTION fixado em _diagnostic_probes');
  assert(DIAGNOSTIC_DOCUMENT_ID === 'connectivity_check', 'DIAGNOSTIC_DOCUMENT_ID fixado em connectivity_check');
  assert(DIAGNOSTIC_DOCUMENT_PATH === '_diagnostic_probes/connectivity_check', 'DIAGNOSTIC_DOCUMENT_PATH fixado em _diagnostic_probes/connectivity_check');

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Tratamento dos Cabeçalhos IAM conforme Cloud Run (Regra 5 e 6) ---');
  // --------------------------------------------------------------------------
  // 2.1 Extração de Authorization: Bearer
  const extractedStandard = extractIamTokenFromHeaders({
    authorization: 'Bearer standard-token-123',
  });
  assert(extractedStandard.token === 'standard-token-123', 'extractIamTokenFromHeaders extrai token do cabeçalho Authorization');
  assert(extractedStandard.source === 'authorization', 'Origem identificada como authorization');
  assert(!extractedStandard.signatureRemovedByGoogle, 'Assinatura intacta');

  // 2.2 Suporte a case-insensitive Bearer
  const extractedCaseInsensitive = extractIamTokenFromHeaders({
    authorization: 'bearer case-insensitive-token-456',
  });
  assert(extractedCaseInsensitive.token === 'case-insensitive-token-456', 'extractIamTokenFromHeaders suporta bearer minúsculo');

  // 2.3 Detecção e Tratamento de SIGNATURE_REMOVED_BY_GOOGLE (Cloud Run X-Serverless-Authorization)
  const strippedJwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.SIGNATURE_REMOVED_BY_GOOGLE';
  const extractedStripped = extractIamTokenFromHeaders({
    'x-serverless-authorization': `Bearer ${strippedJwt}`,
  });
  assert(extractedStripped.signatureRemovedByGoogle === true, 'Detecta com precisão SIGNATURE_REMOVED_BY_GOOGLE inserido pelo Cloud Run');

  // 2.4 Middleware rejeita token com assinatura removida pelo Cloud Run (sem confiar em claims decodificadas)
  const strippedHttpRes = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    'x-serverless-authorization': `Bearer ${strippedJwt}`,
  });
  assert(strippedHttpRes.status === 403, 'Middleware rejeita SIGNATURE_REMOVED_BY_GOOGLE com HTTP 403 Forbidden');
  assert(strippedHttpRes.body?.code === 'IAM_SIGNATURE_STRIPPED', 'Código padronizado IAM_SIGNATURE_STRIPPED retornado');
  assert(
    strippedHttpRes.body?.message?.includes('SIGNATURE_REMOVED_BY_GOOGLE'),
    'Mensagem clara orientando o envio do token com assinatura completa via Authorization'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 3. Proteção contra Acesso Anônimo (Regra 7 — Token Ausente) ---');
  // --------------------------------------------------------------------------
  const anonGet = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore');
  assert(anonGet.status === 401, 'Requisição anônima GET /api/diagnostic/firestore rejeitada com 401 Unauthorized');
  assert(anonGet.body?.code === 'MISSING_IAM_CREDENTIALS', 'Código explícito MISSING_IAM_CREDENTIALS');

  const anonPost = await simulateRequest(diagnosticApp, 'POST', '/api/diagnostic/firestore');
  assert(anonPost.status === 401, 'Requisição anônima POST /api/diagnostic/firestore rejeitada com 401 Unauthorized');

  const emptyHeaderReq = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: '   ',
  });
  assert(emptyHeaderReq.status === 401, 'Authorization vazio rejeitado com 401 Unauthorized');

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Testes de Tokens Inválidos (Regra 8 — Token Inválido) ---');
  // --------------------------------------------------------------------------
  // 4.1 Token malformado (não-JWT)
  const malformedReq = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer not-a-jwt-token',
  });
  assert(malformedReq.status === 403, 'Token malformado rejeitado com 403 Forbidden');
  assert(malformedReq.body?.code === 'INVALID_IAM_CREDENTIALS', 'Código INVALID_IAM_CREDENTIALS para token malformado');

  // 4.2 Segredo estático obsoleto (DIAGNOSTIC_AUTH_TOKEN)
  const legacySecretReq = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer staging-static-secret-token',
  });
  assert(legacySecretReq.status === 403, 'Segredos estáticos são rejeitados com 403 Forbidden (Eliminação de senhas fixas)');

  // 4.3 Token do Firebase Auth para frontend (Anti-Confusão de Credenciais)
  const firebaseAuthReq = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-firebase-token',
  });
  assert(firebaseAuthReq.status === 403, 'Token do Firebase Auth rejeitado para invocação IAM com 403 Forbidden');
  assert(firebaseAuthReq.body?.code === 'FIREBASE_AUTH_TOKEN_REJECTED', 'Código FIREBASE_AUTH_TOKEN_REJECTED impedindo confusão de credenciais');

  // 4.4 Token expirado
  const expiredReq = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-expired-token',
  });
  assert(expiredReq.status === 403, 'Token expirado rejeitado com 403 Forbidden');
  assert(expiredReq.body?.code === 'TOKEN_EXPIRED', 'Código TOKEN_EXPIRED retornado');

  // 4.5 Emissor incorreto
  const wrongIssReq = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-wrong-issuer',
  });
  assert(wrongIssReq.status === 403, 'Token com emissor incorreto rejeitado com 403 Forbidden');
  assert(wrongIssReq.body?.code === 'INVALID_IAM_ISSUER', 'Código INVALID_IAM_ISSUER retornado');

  // --------------------------------------------------------------------------
  console.log('\n--- 5. Testes de Audiência Incorreta (Regra 8 — Audiência) ---');
  // --------------------------------------------------------------------------
  const expectedServiceUrl = 'https://itissimple-backend-diagnostic.us-east5.run.app';
  process.env.EXPECTED_AUDIENCE = expectedServiceUrl;

  const wrongAudReq = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-wrong-audience',
  });
  assert(wrongAudReq.status === 403, 'Token com audience incorreta rejeitado com 403 Forbidden');
  assert(wrongAudReq.body?.code === 'INVALID_IAM_AUDIENCE', 'Código padronizado INVALID_IAM_AUDIENCE retornado');

  // --------------------------------------------------------------------------
  console.log('\n--- 6. Testes de Identidade Não Autorizada (Regra 8 — Identidade) ---');
  // --------------------------------------------------------------------------
  // 6.1 Identidade externa arbitrária
  const externalCallerReq = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-unauthorized-caller',
  });
  assert(externalCallerReq.status === 403, 'Identidade Google externa não cadastrada rejeitada com 403');
  assert(externalCallerReq.body?.code === 'UNAUTHORIZED_IAM_IDENTITY', 'Código UNAUTHORIZED_IAM_IDENTITY retornado');

  // 6.2 Service account do mesmo projeto mas não listada (Zero Wildcards)
  const unlistedSaReq = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-unlisted-sa',
  });
  assert(unlistedSaReq.status === 403, 'Service account não listada explicitamente rejeitada com 403');
  assert(unlistedSaReq.body?.code === 'UNAUTHORIZED_IAM_IDENTITY', 'Código UNAUTHORIZED_IAM_IDENTITY para SA não autorizada');

  // 6.3 Usuário com email_verified=true mas fora da allowlist
  const verifiedStrangerReq = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-verified-only',
  });
  assert(verifiedStrangerReq.status === 403, 'Usuário com email_verified=true fora da allowlist rejeitado com 403');
  assert(
    !isAuthorizedIamPrincipal('stranger@gmail.com'),
    'isAuthorizedIamPrincipal retorna false para e-mails fora da allowlist mesmo que verificados'
  );

  // 6.4 Identidades Autorizadas na Allowlist Estrita
  assert(
    isAuthorizedIamPrincipal('sa-diagnostic-backend@itissimple-security-staging.iam.gserviceaccount.com'),
    'sa-diagnostic-backend é autorizada'
  );
  assert(
    isAuthorizedIamPrincipal('sa-diagnostic-caller@itissimple-security-staging.iam.gserviceaccount.com'),
    'sa-diagnostic-caller é autorizada'
  );
  assert(
    isAuthorizedIamPrincipal('adm.itissimple@gmail.com'),
    'adm.itissimple@gmail.com é autorizada'
  );
  assert(
    !isAuthorizedIamPrincipal('*@itissimple-security-staging.iam.gserviceaccount.com'),
    'Curinga (*@...) é categoricamente rejeitado'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 7. Testes Criptográficos RSA-SHA256 (Regra 6 — Validação Real) ---');
  // --------------------------------------------------------------------------
  const { publicKey: testPub, privateKey: testPriv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const { privateKey: fakePriv } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  function makeRsaJwt(payload: Record<string, any>, key: string): string {
    const header = { alg: 'RS256', typ: 'JWT' };
    const encH = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encP = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const data = `${encH}.${encP}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(data);
    const sig = signer.sign(key, 'base64url');
    return `${data}.${sig}`;
  }

  setTestPublicKeyForVerification(testPub);

  const nowSec = Math.floor(Date.now() / 1000);
  const validPayload = {
    iss: 'https://accounts.google.com',
    aud: expectedServiceUrl,
    sub: '109876543210987654321',
    email: 'sa-diagnostic-caller@itissimple-security-staging.iam.gserviceaccount.com',
    email_verified: true,
    exp: nowSec + 3600,
    iat: nowSec,
  };

  // 7.1 JWT com assinatura RSA válida
  const realValidJwt = makeRsaJwt(validPayload, testPriv);
  const cryptoValid = await verifyGoogleCloudIamToken(realValidJwt);
  assert(cryptoValid.valid === true, 'Token com assinatura RSA-SHA256 válida verificado com sucesso');
  assert(cryptoValid.email === validPayload.email, 'Identidade do caller autenticada');

  // 7.2 JWT com assinatura forjada
  const forgedJwt = makeRsaJwt(validPayload, fakePriv);
  const cryptoForged = await verifyGoogleCloudIamToken(forgedJwt);
  assert(cryptoForged.valid === false, 'Token com assinatura forjada é rejeitado criptograficamente');
  assert(cryptoForged.code === 'INVALID_IAM_CREDENTIALS', 'Código INVALID_IAM_CREDENTIALS para assinatura inválida');

  // 7.3 JWT com payload adulterado
  const parts = realValidJwt.split('.');
  const tamperedPayload = { ...validPayload, email: 'adm.itissimple@gmail.com' };
  const tamperedJwt = `${parts[0]}.${Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url')}.${parts[2]}`;
  const cryptoTampered = await verifyGoogleCloudIamToken(tamperedJwt);
  assert(cryptoTampered.valid === false, 'Token com payload adulterado é rejeitado');

  setTestPublicKeyForVerification(null);
  delete process.env.EXPECTED_AUDIENCE;

  // --------------------------------------------------------------------------
  console.log('\n--- 8. Sonda Firestore Fase 1A: get() Único e Restrições (Regras 2, 3, 4, 8) ---');
  // --------------------------------------------------------------------------
  let getCallCount = 0;
  let setCallCount = 0;
  let deleteCallCount = 0;
  let requestedCollection = '';
  let requestedDocId = '';

  const mockCleanFirestore: any = {
    projectId: DIAGNOSTIC_PROJECT_ID,
    collection: (col: string) => {
      requestedCollection = col;
      return {
        doc: (docId: string) => {
          requestedDocId = docId;
          return {
            get: async () => {
              getCallCount++;
              return {
                exists: true,
                data: () => ({ sensitiveInternalField: 'SHOULD_NEVER_BE_IN_RESPONSE' }),
              };
            },
            set: async () => {
              setCallCount++;
              throw new Error('VIOLATION: set() should never be called!');
            },
            delete: async () => {
              deleteCallCount++;
              throw new Error('VIOLATION: delete() should never be called!');
            },
          };
        },
      };
    },
  };

  setFirebaseAdminFirestoreForTesting(mockCleanFirestore);

  // 8.1 Execução com documento existente
  const probeResultExists = await executeFirestoreDiagnosticProbe();
  assert(probeResultExists.success === true, 'Sonda de diagnóstico retorna success: true');
  assert(probeResultExists.status === 'connected', 'Sonda retorna status: "connected"');
  assert(requestedCollection === '_diagnostic_probes', 'Coleção acessada exclusivamente: _diagnostic_probes');
  assert(requestedDocId === 'connectivity_check', 'Documento acessado exclusivamente: connectivity_check');
  assert(probeResultExists.documentPath === '_diagnostic_probes/connectivity_check', 'documentPath estruturado');
  assert(probeResultExists.documentExists === true, 'documentExists é true quando snapshot existe');
  assert(getCallCount === 1, 'Exatamente UMA (1) operação get() executada');
  assert(setCallCount === 0, 'ZERO operações set() executadas (Proibição de criação/alteração)');
  assert(deleteCallCount === 0, 'ZERO operações delete() executadas (Proibição de exclusão)');
  assert(probeResultExists.operation.type === 'get', 'operation.type é estritamente "get"');
  assert(probeResultExists.operation.status === 'confirmed', 'operation.status é "confirmed"');
  assert(typeof probeResultExists.operation.durationMs === 'number', 'Latência durationMs registrada com precisão');

  // 8.2 Garantia de Não-Exposição de Conteúdo ou Segredos (Regra 4)
  assert(
    (probeResultExists as any).sensitiveInternalField === undefined,
    'Conteúdo interno do documento NÃO é exposto na resposta'
  );
  assert(
    (probeResultExists as any).data === undefined,
    'Objeto data() do documento NÃO é incluído na resposta'
  );
  assert(
    (probeResultExists as any).privateKey === undefined && (probeResultExists as any).token === undefined,
    'Zero credenciais ou segredos expostos na resposta'
  );

  // 8.3 Execução com documento inexistente (exists: false)
  const mockNotFoundFirestore: any = {
    projectId: DIAGNOSTIC_PROJECT_ID,
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false, data: () => undefined }),
      }),
    }),
  };

  setFirebaseAdminFirestoreForTesting(mockNotFoundFirestore);
  const probeResultNotFound = await executeFirestoreDiagnosticProbe();
  assert(probeResultNotFound.success === true, 'Sonda tem sucesso mesmo se documento não existe (conectividade comprovada)');
  assert(probeResultNotFound.documentExists === false, 'documentExists é false quando snapshot não existe');
  assert(probeResultNotFound.status === 'connected', 'Status reportado como connected');

  // --------------------------------------------------------------------------
  console.log('\n--- 9. Erros de Conectividade Firestore (Regra 8 — Erros Firestore) ---');
  // --------------------------------------------------------------------------
  // 9.1 Firestore Indisponível (getFirestoreDb() retorna null)
  setFirestoreDbResolverForTesting(() => null);
  const unavailResult = await executeFirestoreDiagnosticProbe();
  assert(!unavailResult.success, 'Falha quando Firestore client está indisponível');
  assert(unavailResult.failedStep === 'initialization', 'failedStep identificado como "initialization"');
  assert(unavailResult.code === 'FIRESTORE_UNAVAILABLE', 'Código padronizado FIRESTORE_UNAVAILABLE');
  setFirestoreDbResolverForTesting(null);

  // 9.2 Erro de Permissão IAM (7 PERMISSION_DENIED)
  const mockPermDenied: any = {
    projectId: DIAGNOSTIC_PROJECT_ID,
    collection: () => ({
      doc: () => ({
        get: async () => {
          const err: any = new Error('7 PERMISSION_DENIED: Caller does not have datastore.entities.get on _diagnostic_probes/connectivity_check');
          err.code = 7;
          throw err;
        },
      }),
    }),
  };
  setFirebaseAdminFirestoreForTesting(mockPermDenied);
  const permDeniedResult = await executeFirestoreDiagnosticProbe();
  assert(!permDeniedResult.success, 'Falha identificada quando permissão IAM é negada');
  assert(permDeniedResult.failedStep === 'read', 'failedStep identificado como "read"');
  assert(permDeniedResult.code === 7, 'Código 7 (PERMISSION_DENIED) preservado');
  assert(permDeniedResult.operation.status === 'failed', 'Status da operação marcado como failed');

  // Resposta HTTP 403 para PERMISSION_DENIED
  const httpPermDenied = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-oidc-token',
  });
  assert(httpPermDenied.status === 403, 'Endpoint /api/diagnostic/firestore retorna 403 Forbidden para PERMISSION_DENIED');

  // 9.3 Erro de Rede / Indisponibilidade Transitória (14 UNAVAILABLE)
  const mockNetworkUnavailable: any = {
    projectId: DIAGNOSTIC_PROJECT_ID,
    collection: () => ({
      doc: () => ({
        get: async () => {
          const err: any = new Error('14 UNAVAILABLE: TCP connection failed / DNS resolution timeout');
          err.code = 14;
          throw err;
        },
      }),
    }),
  };
  setFirebaseAdminFirestoreForTesting(mockNetworkUnavailable);
  const netUnavailResult = await executeFirestoreDiagnosticProbe();
  assert(!netUnavailResult.success, 'Falha identificada em erro transitório de rede');
  assert(netUnavailResult.code === 14, 'Código 14 (UNAVAILABLE) preservado');

  // Resposta HTTP 503 para erro de conectividade
  const httpNetUnavail = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore', {
    Authorization: 'Bearer mock-iam-oidc-token',
  });
  assert(httpNetUnavail.status === 503, 'Endpoint /api/diagnostic/firestore retorna 503 Service Unavailable para erro transitório');

  // 9.4 Verificação Explícita de Projeto: Tentativa com Projeto Proibido itissimple-8663d (Regra 3)
  process.env.FIREBASE_PROJECT_ID = 'itissimple-8663d';
  const legacyProjResult = await executeFirestoreDiagnosticProbe();
  assert(!legacyProjResult.success, 'Sonda bloqueia imediatamente tentativa de execução no projeto legado proibido itissimple-8663d');
  assert(legacyProjResult.failedStep === 'project_validation', 'failedStep é "project_validation"');
  assert(
    legacyProjResult.code === 'PROJECT_UNAUTHORIZED' || legacyProjResult.code === 'FORBIDDEN_PROJECT',
    'Código explícito de rejeição por projeto não autorizado'
  );
  process.env.FIREBASE_PROJECT_ID = DIAGNOSTIC_PROJECT_ID;

  // 9.5 Verificação Explícita de Banco: Tentativa com Banco Não Autorizado
  process.env.FIREBASE_DATABASE_ID = 'unauthorized_db';
  const wrongDbResult = await executeFirestoreDiagnosticProbe();
  assert(!wrongDbResult.success, 'Sonda bloqueia execução em banco diferente de (default)');
  assert(wrongDbResult.code === 'FORBIDDEN_DATABASE', 'Código explícito FORBIDDEN_DATABASE');
  process.env.FIREBASE_DATABASE_ID = DIAGNOSTIC_DATABASE_ID;

  // --------------------------------------------------------------------------
  console.log('\n--- 10. Garantias de Armazenamento e Integridade Local ---');
  // --------------------------------------------------------------------------
  // 10.1 Zero escrita em app_db.json
  const appDbPath = path.join(process.cwd(), 'src', 'data', 'app_db.json');
  if (fs.existsSync(appDbPath)) {
    const statsBefore = fs.statSync(appDbPath);
    const contentBefore = fs.readFileSync(appDbPath);
    const hashBefore = crypto.createHash('sha256').update(contentBefore).digest('hex');

    // Executa operações de diagnóstico
    await executeFirestoreDiagnosticProbe();
    await simulateRequest(diagnosticApp, 'GET', '/api/health');

    const statsAfter = fs.statSync(appDbPath);
    const contentAfter = fs.readFileSync(appDbPath);
    const hashAfter = crypto.createHash('sha256').update(contentAfter).digest('hex');

    assert(hashBefore === hashAfter, 'SHA256 de app_db.json permanece 100% idêntico (Zero escrita local)');
    assert(statsBefore.mtimeMs === statsAfter.mtimeMs, 'Data de modificação mtime de app_db.json não foi alterada');
  } else {
    assert(true, 'app_db.json ausente (ambiente sem banco local)');
  }

  // 10.2 Verificação de ausência de referências a localStorage, sessionStorage e IndexedDB no backend
  const diagBackendCode = fs.readFileSync(path.join(process.cwd(), 'src', 'serverDiagnostic.ts'), 'utf8');
  assert(!diagBackendCode.includes('localStorage'), 'serverDiagnostic.ts não contém chamadas a localStorage');
  assert(!diagBackendCode.includes('sessionStorage'), 'serverDiagnostic.ts não contém chamadas a sessionStorage');
  assert(!diagBackendCode.includes('indexedDB'), 'serverDiagnostic.ts não contém chamadas a IndexedDB');

  // Restaura mocks
  resetFirebaseAdminFirestoreForTesting();

  console.log('\n=========================================================================');
  console.log(`TOTAL DE TESTES FASE 1A: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhase1ATests().catch((err) => {
  console.error('Fatal error in Phase 1A test suite:', err);
  process.exit(1);
});
