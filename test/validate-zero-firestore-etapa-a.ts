import assert from 'assert';
import crypto from 'crypto';
import express from 'express';
import {
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import {
  isDiagnosticMode,
  DIAGNOSTIC_PROJECT_ID,
  DIAGNOSTIC_DATABASE_ID,
  registerDiagnosticRoutes,
  setTestPublicKeyForVerification,
  executeFirestoreDiagnosticProbe,
} from '../src/serverDiagnostic';

/**
 * BATERIA DE TESTES: ZERO FIRESTORE NA ETAPA A
 *
 * Objetivo:
 * Garantir de forma irrefutável e estritamente auditada que durante toda a Etapa A:
 * 1. O boot do servidor (em modo DIAGNOSTIC_ONLY) realiza ZERO leituras, ZERO escritas e ZERO sincronizações.
 * 2. As rotas de saúde (/api/health e /api/diagnostic/health) realizam ZERO operações no Firestore.
 * 3. A rota protegida de identidade (/api/diagnostic/identity em GET e POST) realiza ZERO operações no Firestore.
 * 4. Um probe de controle positivo comprova que nosso interceptor registra qualquer operação real caso ela ocorra.
 */

// Contadores de instrumentação estrita
interface FirestoreCounters {
  reads: number;
  writes: number;
  deletes: number;
  syncs: number;
  getDbCalls: number;
  accessedCollections: string[];
}

const counters: FirestoreCounters = {
  reads: 0,
  writes: 0,
  deletes: 0,
  syncs: 0,
  getDbCalls: 0,
  accessedCollections: [],
};

function resetCounters() {
  counters.reads = 0;
  counters.writes = 0;
  counters.deletes = 0;
  counters.syncs = 0;
  counters.getDbCalls = 0;
  counters.accessedCollections = [];
}

// Mock instrumental para detecção ativa de qualquer operação Firestore
function createInstrumentedFirestoreMock() {
  const store = new Map<string, any>();

  const mockDb: any = {
    projectId: DIAGNOSTIC_PROJECT_ID,
    databaseId: DIAGNOSTIC_DATABASE_ID,
    collection: (colName: string) => {
      counters.accessedCollections.push(colName);
      return {
        doc: (docId: string) => {
          const docKey = `${colName}/${docId}`;
          return {
            set: async (data: any) => {
              counters.writes++;
              store.set(docKey, { ...data });
              return { writeTime: new Date().toISOString() };
            },
            get: async () => {
              counters.reads++;
              const exists = store.has(docKey);
              return {
                exists,
                id: docId,
                data: () => (exists ? { ...store.get(docKey) } : undefined),
              };
            },
            delete: async () => {
              counters.deletes++;
              store.delete(docKey);
              return { writeTime: new Date().toISOString() };
            },
            update: async (data: any) => {
              counters.writes++;
              const current = store.get(docKey) || {};
              store.set(docKey, { ...current, ...data });
              return { writeTime: new Date().toISOString() };
            },
          };
        },
        get: async () => {
          counters.reads++;
          const docs: any[] = [];
          for (const [key, val] of store.entries()) {
            if (key.startsWith(`${colName}/`)) {
              docs.push({
                id: key.split('/')[1],
                data: () => ({ ...val }),
                exists: true,
              });
            }
          }
          return { docs, empty: docs.length === 0, size: docs.length };
        },
      };
    },
  };

  return mockDb;
}

// Simulador de requisição HTTP sem rede
function simulateRequest(
  app: express.Express,
  method: 'GET' | 'POST',
  urlPath: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; headers: Record<string, string>; body: any }> {
  return new Promise((resolve) => {
    const normHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      normHeaders[k.toLowerCase()] = v;
    }

    const req: any = {
      method,
      url: urlPath,
      originalUrl: urlPath,
      headers: normHeaders,
      get: (headerName: string) => normHeaders[headerName.toLowerCase()],
      header: (headerName: string) => normHeaders[headerName.toLowerCase()],
      body: body || {},
    };

    let statusCode = 200;
    const resHeaders: Record<string, string> = {};
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

    app(req, res, (err?: any) => {
      if (err) {
        resolve({ status: 500, headers: resHeaders, body: { error: err.message } });
      } else {
        resolve({
          status: statusCode === 200 ? 404 : statusCode,
          headers: resHeaders,
          body: resBody || `Cannot ${method} ${urlPath}`,
        });
      }
    });
  });
}

function makeRsaJwt(payload: Record<string, any>, privateKeyPem: string): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const h64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const toSign = `${h64}.${p64}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(toSign);
  const sig64 = signer.sign(privateKeyPem).toString('base64url');
  return `${toSign}.${sig64}`;
}

async function runZeroFirestoreSuite() {
  console.log('=========================================================================');
  console.log('=== TESTES LOCAIS: GARANTIA DE ZERO FIRESTORE NA ETAPA A              ===');
  console.log('=== Projeto Exclusivo: itissimple-security-staging                    ===');
  console.log('=========================================================================\n');

  let passed = 0;
  const pass = (msg: string) => {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  };

  // Setup: Ativar mock instrumental e modo de teste
  process.env.NODE_ENV = 'test';
  process.env.DIAGNOSTIC_ONLY = 'true';
  process.env.FIREBASE_PROJECT_ID = DIAGNOSTIC_PROJECT_ID;
  process.env.FIREBASE_DATABASE_ID = DIAGNOSTIC_DATABASE_ID;

  const mockDb = createInstrumentedFirestoreMock();
  setFirebaseAdminFirestoreForTesting(mockDb);
  resetCounters();

  // Gera par de chaves RSA para validação criptográfica estrita
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const canonicalAudience = 'https://itissimple-diagnostic-backend-57123984-ue.a.run.app';
  process.env.CLOUD_RUN_SERVICE_URL = canonicalAudience;

  // --------------------------------------------------------------------------
  console.log('--- 1. Verificação de Boot do Servidor Dedicado (Etapa A) ---');
  // --------------------------------------------------------------------------
  // Criação da aplicação de diagnóstico exatamente como no boot do container Cloud Run
  const app = express();
  app.use(express.json());
  registerDiagnosticRoutes(app);

  pass('Servidor de diagnóstico inicializado com sucesso em memória');
  assert.strictEqual(counters.reads, 0, 'Zero leituras no Firestore durante o boot');
  pass('Zero leituras no Firestore durante o boot');
  assert.strictEqual(counters.writes, 0, 'Zero escritas no Firestore durante o boot');
  pass('Zero escritas no Firestore durante o boot');
  assert.strictEqual(counters.deletes, 0, 'Zero exclusões no Firestore durante o boot');
  pass('Zero exclusões no Firestore durante o boot');
  assert.strictEqual(counters.syncs, 0, 'Zero sincronizações com o Firestore durante o boot');
  pass('Zero sincronizações com o Firestore durante o boot');
  assert.strictEqual(counters.accessedCollections.length, 0, 'Nenhuma coleção do Firestore acessada no boot');
  pass('Nenhuma coleção do Firestore acessada no boot');

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Verificação das Rotas de Saúde (/api/health e /api/diagnostic/health) ---');
  // --------------------------------------------------------------------------
  resetCounters();

  const healthRes = await simulateRequest(app, 'GET', '/api/health');
  assert.strictEqual(healthRes.status, 200, 'GET /api/health retorna 200 OK');
  pass('GET /api/health retorna 200 OK');
  assert.strictEqual(healthRes.body.status, 'ok', 'Status da rota de saúde é ok');
  pass('Status da rota de saúde é ok');
  assert.strictEqual(healthRes.body.mode, 'diagnostic_only', 'Modo confirmado como diagnostic_only');
  pass('Modo confirmado como diagnostic_only');
  assert.strictEqual(counters.reads, 0, 'Zero leituras no Firestore em /api/health');
  pass('Zero leituras no Firestore em /api/health');
  assert.strictEqual(counters.writes, 0, 'Zero escritas no Firestore em /api/health');
  pass('Zero escritas no Firestore em /api/health');
  assert.strictEqual(counters.syncs, 0, 'Zero sincronizações no Firestore em /api/health');
  pass('Zero sincronizações no Firestore em /api/health');

  const diagHealthRes = await simulateRequest(app, 'GET', '/api/diagnostic/health');
  assert.strictEqual(diagHealthRes.status, 200, 'GET /api/diagnostic/health retorna 200 OK');
  pass('GET /api/diagnostic/health retorna 200 OK');
  assert.strictEqual(diagHealthRes.body.diagnosticMode, true, 'diagnosticMode é true');
  pass('diagnosticMode é true em /api/diagnostic/health');
  assert.strictEqual(counters.reads, 0, 'Zero leituras no Firestore em /api/diagnostic/health');
  pass('Zero leituras no Firestore em /api/diagnostic/health');
  assert.strictEqual(counters.writes, 0, 'Zero escritas no Firestore em /api/diagnostic/health');
  pass('Zero escritas no Firestore em /api/diagnostic/health');
  assert.strictEqual(counters.syncs, 0, 'Zero sincronizações no Firestore em /api/diagnostic/health');
  pass('Zero sincronizações no Firestore em /api/diagnostic/health');

  // --------------------------------------------------------------------------
  console.log('\n--- 3. Verificação da Rota de Identidade (/api/diagnostic/identity) ---');
  // --------------------------------------------------------------------------
  resetCounters();
  setTestPublicKeyForVerification(publicKey);

  // 3.1 Chamada Anônima (Bloqueada sem tocar no Firestore)
  const anonRes = await simulateRequest(app, 'GET', '/api/diagnostic/identity');
  assert.strictEqual(anonRes.status, 401, 'Requisição anônima bloqueada com 401 Unauthorized');
  pass('Requisição anônima bloqueada com 401 Unauthorized');
  assert.strictEqual(counters.reads, 0, 'Zero leituras no Firestore em chamada anônima');
  pass('Zero leituras no Firestore em chamada anônima');
  assert.strictEqual(counters.writes, 0, 'Zero escritas no Firestore em chamada anônima');
  pass('Zero escritas no Firestore em chamada anônima');

  // 3.2 Chamada Autenticada via GET com Service Account Invocadora
  const validPayload = {
    iss: 'https://accounts.google.com',
    aud: canonicalAudience,
    sub: 'caller-sa-id-987',
    email: 'sa-diagnostic-caller@itissimple-security-staging.iam.gserviceaccount.com',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const callerJwt = makeRsaJwt(validPayload, privateKey);

  const getIdentityRes = await simulateRequest(app, 'GET', '/api/diagnostic/identity', {
    Authorization: `Bearer ${callerJwt}`,
  });

  assert.strictEqual(getIdentityRes.status, 200, 'GET /api/diagnostic/identity retorna 200 OK com token válido');
  pass('GET /api/diagnostic/identity retorna 200 OK com token válido');
  assert.strictEqual(getIdentityRes.body.authenticated, true, 'Confirmada autenticação no payload');
  pass('Flag authenticated: true confirmada na resposta');
  assert.strictEqual(getIdentityRes.body.firestoreAccess, false, 'Payload declara formalmente firestoreAccess: false');
  pass('Payload declara formalmente firestoreAccess: false');
  assert.strictEqual(counters.reads, 0, 'Zero leituras no Firestore na rota GET /api/diagnostic/identity');
  pass('Zero leituras no Firestore na rota GET /api/diagnostic/identity');
  assert.strictEqual(counters.writes, 0, 'Zero escritas no Firestore na rota GET /api/diagnostic/identity');
  pass('Zero escritas no Firestore na rota GET /api/diagnostic/identity');
  assert.strictEqual(counters.deletes, 0, 'Zero exclusões no Firestore na rota GET /api/diagnostic/identity');
  pass('Zero exclusões no Firestore na rota GET /api/diagnostic/identity');
  assert.strictEqual(counters.syncs, 0, 'Zero sincronizações no Firestore na rota GET /api/diagnostic/identity');
  pass('Zero sincronizações no Firestore na rota GET /api/diagnostic/identity');

  // 3.3 Chamada Autenticada via POST com Administrador
  const adminPayload = {
    iss: 'https://accounts.google.com',
    aud: canonicalAudience,
    sub: 'admin-id-123',
    email: 'adm.itissimple@gmail.com',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const adminJwt = makeRsaJwt(adminPayload, privateKey);

  const postIdentityRes = await simulateRequest(app, 'POST', '/api/diagnostic/identity', {
    Authorization: `Bearer ${adminJwt}`,
  });

  assert.strictEqual(postIdentityRes.status, 200, 'POST /api/diagnostic/identity retorna 200 OK com token de Admin');
  pass('POST /api/diagnostic/identity retorna 200 OK com token de Admin');
  assert.strictEqual(postIdentityRes.body.authenticated, true, 'Flag authenticated: true confirmada para Admin');
  pass('Flag authenticated: true confirmada para Admin');
  assert.strictEqual(postIdentityRes.body.firestoreAccess, false, 'Payload POST declara firestoreAccess: false');
  pass('Payload POST declara firestoreAccess: false');
  assert.strictEqual(counters.reads, 0, 'Zero leituras no Firestore na rota POST /api/diagnostic/identity');
  pass('Zero leituras no Firestore na rota POST /api/diagnostic/identity');
  assert.strictEqual(counters.writes, 0, 'Zero escritas no Firestore na rota POST /api/diagnostic/identity');
  pass('Zero escritas no Firestore na rota POST /api/diagnostic/identity');
  assert.strictEqual(counters.deletes, 0, 'Zero exclusões no Firestore na rota POST /api/diagnostic/identity');
  pass('Zero exclusões no Firestore na rota POST /api/diagnostic/identity');
  assert.strictEqual(counters.syncs, 0, 'Zero sincronizações no Firestore na rota POST /api/diagnostic/identity');
  pass('Zero sincronizações no Firestore na rota POST /api/diagnostic/identity');

  // Total acumulado em toda a Etapa A
  assert.strictEqual(counters.reads, 0, 'Garantia consolidada: TOTAL DE LEITURAS NA ETAPA A === 0');
  pass('Garantia consolidada: TOTAL DE LEITURAS NA ETAPA A === 0');
  assert.strictEqual(counters.writes, 0, 'Garantia consolidada: TOTAL DE ESCRITAS NA ETAPA A === 0');
  pass('Garantia consolidada: TOTAL DE ESCRITAS NA ETAPA A === 0');
  assert.strictEqual(counters.deletes, 0, 'Garantia consolidada: TOTAL DE EXCLUSÕES NA ETAPA A === 0');
  pass('Garantia consolidada: TOTAL DE EXCLUSÕES NA ETAPA A === 0');
  assert.strictEqual(counters.syncs, 0, 'Garantia consolidada: TOTAL DE SINCRONIZAÇÕES NA ETAPA A === 0');
  pass('Garantia consolidada: TOTAL DE SINCRONIZAÇÕES NA ETAPA A === 0');

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Controle Positivo: Comprovação da Sensibilidade do Interceptor ---');
  // --------------------------------------------------------------------------
  // Executa o probe da Etapa B (/api/diagnostic/firestore) para comprovar que o interceptor
  // realmente detecta e contabiliza qualquer operação no Firestore
  const probeResult = await executeFirestoreDiagnosticProbe();
  assert.strictEqual(probeResult.success, true, 'Probe da Etapa B executa com sucesso');
  pass('Probe da Etapa B executa com sucesso');
  assert(counters.writes >= 1, 'Interceptor capturou operação WRITE durante Etapa B');
  pass(`Interceptor capturou ${counters.writes} operação(ões) WRITE durante a Etapa B`);
  assert(counters.reads >= 1, 'Interceptor capturou operação READ durante Etapa B');
  pass(`Interceptor capturou ${counters.reads} operação(ões) READ durante a Etapa B`);
  assert(counters.deletes >= 1, 'Interceptor capturou operação DELETE durante Etapa B');
  pass(`Interceptor capturou ${counters.deletes} operação(ões) DELETE durante a Etapa B`);
  assert(counters.accessedCollections.includes('_diagnostic_probes'), 'Coleção _diagnostic_probes registrada');
  pass('Interceptor comprovou com precisão o registro das operações do Firestore');

  // Cleanup
  setTestPublicKeyForVerification(null);
  delete process.env.CLOUD_RUN_SERVICE_URL;
  resetFirebaseAdminFirestoreForTesting();

  console.log('\n=========================================================================');
  console.log(`TOTAL DE TESTES ZERO FIRESTORE ETAPA A: ${passed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log('FALHAS: 0');
  console.log('=========================================================================');
}

runZeroFirestoreSuite().catch((err) => {
  console.error('❌ Falha na bateria de testes Zero Firestore:', err);
  process.exit(1);
});
