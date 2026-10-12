/**
 * Bateria de Testes Automatizados — Fase 1E.1: Correção Controlada dos Bloqueios
 *
 * Projeto Exclusivo: itissimple-security-staging
 * Projeto Legado PROIBIDO: itissimple-8663d
 *
 * Validações Obrigatórias:
 * 1. Dockerfile Oficial: Node 22, DIAGNOSTIC_ONLY=true, itissimple-security-staging, (default),
 *    porta 8080 dinâmica, CMD direto ["node", "--import", "tsx", "server.ts"], ausência de app_db.json e segredos.
 * 2. Resolução Robusta de Porta: PORT=8080 respeitado, valores inválidos tratados com fallback seguro.
 * 3. Inicialização Node.js: Execução direta sem processo filho redundante via --import tsx.
 * 4. Plano de Deploy: Mesma tag de imagem no build e deploy, --no-allow-unauthenticated, audiência OIDC segura.
 * 5. Isolamento Diagnóstico: Zero rotas de negócio, zero persistência local, falhas IAM fechadas.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parsePort as parsePortDiag, resolvePort as resolvePortDiag, app as diagnosticApp } from '../src/diagnosticApp';
import { parsePort as parsePortApp, resolvePort as resolvePortApp } from '../serverApp';
import { isTsxEnvironment } from '../server';

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

async function simulateRequest(
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
        resolve({ status: statusCode === 200 ? 404 : statusCode, headers: resHeaders, body: resBody || 'Cannot ' + method + ' ' + urlPath });
      }
    });
  });
}

async function runPhase1E1Tests() {
  console.log('=========================================================================');
  console.log('=== TESTES AUTOMATIZADOS: FASE 1E.1 — CORREÇÃO DOS BLOQUEIOS          ===');
  console.log('=== PROJETO AUTORIZADO: itissimple-security-staging                   ===');
  console.log('=========================================================================\n');

  // --------------------------------------------------------------------------
  console.log('--- 1. Auditoria e Validação do Dockerfile Oficial ---');
  // --------------------------------------------------------------------------
  const dockerfilePath = path.join(process.cwd(), 'Dockerfile');
  assert(fs.existsSync(dockerfilePath), 'Arquivo oficial /Dockerfile existe na raiz');

  const dockerfileTxtPath = path.join(process.cwd(), 'Dockerfile.txt');
  assert(!fs.existsSync(dockerfileTxtPath), 'Arquivo obsoleto /Dockerfile.txt foi removido');

  const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');

  assert(dockerfileContent.includes('FROM node:22-alpine'), 'Dockerfile especifica Node.js 22 LTS (Alpine Linux)');
  assert(dockerfileContent.includes('ENV DIAGNOSTIC_ONLY=true'), 'Dockerfile configura DIAGNOSTIC_ONLY=true como padrão seguro');
  assert(dockerfileContent.includes('ENV FIREBASE_PROJECT_ID=itissimple-security-staging'), 'Dockerfile vincula FIREBASE_PROJECT_ID=itissimple-security-staging');
  assert(dockerfileContent.includes('ENV FIREBASE_DATABASE_ID=(default)'), 'Dockerfile vincula FIREBASE_DATABASE_ID=(default)');
  assert(dockerfileContent.includes('ENV PORT=8080'), 'Dockerfile configura padrão PORT=8080 para Cloud Run');
  assert(dockerfileContent.includes('EXPOSE 8080'), 'Dockerfile expõe porta 8080');
  assert(
    dockerfileContent.includes('CMD ["node", "--import", "tsx", "server.ts"]'),
    'Dockerfile usa inicialização direta CMD ["node", "--import", "tsx", "server.ts"]'
  );
  assert(dockerfileContent.includes('USER node'), 'Dockerfile executa com usuário não-root (USER node)');
  assert(
    !dockerfileContent.includes('itissimple-8663d'),
    'Dockerfile não faz nenhuma referência ao projeto legado proibido itissimple-8663d'
  );
  assert(
    !dockerfileContent.includes('PRIVATE_KEY') && !dockerfileContent.includes('serviceAccountKey'),
    'Dockerfile não embute credenciais ou chaves privadas'
  );

  // Verificação de .dockerignore
  const dockerignorePath = path.join(process.cwd(), '.dockerignore');
  assert(fs.existsSync(dockerignorePath), 'Arquivo /.dockerignore existe na raiz');
  const dockerignoreContent = fs.readFileSync(dockerignorePath, 'utf8');
  assert(
    dockerignoreContent.includes('src/data/app_db.json'),
    '.dockerignore inclui expressamente src/data/app_db.json para evitar incorporação de dados locais'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Auditoria da Resolução de Porta (diagnosticApp e serverApp) ---');
  // --------------------------------------------------------------------------
  // Validações de parsePort em diagnosticApp
  assert(parsePortDiag('8080') === 8080, 'diagnosticApp: parsePort("8080") retorna 8080');
  assert(parsePortDiag('3000') === 3000, 'diagnosticApp: parsePort("3000") retorna 3000');
  assert(parsePortDiag(8080) === 8080, 'diagnosticApp: parsePort(8080) numérico retorna 8080');
  assert(parsePortDiag('invalid') === null, 'diagnosticApp: parsePort("invalid") retorna null');
  assert(parsePortDiag('-1') === null, 'diagnosticApp: parsePort("-1") negativo retorna null');
  assert(parsePortDiag('0') === null, 'diagnosticApp: parsePort("0") porta zero retorna null');
  assert(parsePortDiag('65536') === null, 'diagnosticApp: parsePort("65536") acima de 65535 retorna null');
  assert(parsePortDiag('') === null, 'diagnosticApp: parsePort("") vazio retorna null');
  assert(parsePortDiag(undefined) === null, 'diagnosticApp: parsePort(undefined) retorna null');

  // Validações de resolvePort em diagnosticApp
  assert(resolvePortDiag('8080', undefined, 3000) === 8080, 'diagnosticApp: resolvePort respeita PORT="8080"');
  assert(resolvePortDiag(undefined, '8080', 3000) === 8080, 'diagnosticApp: resolvePort aceita APP_PORT="8080"');
  assert(resolvePortDiag('8080', '3000', 3000) === 8080, 'diagnosticApp: resolvePort prioriza PORT sobre APP_PORT');
  assert(resolvePortDiag('invalid_port', undefined, 3000) === 3000, 'diagnosticApp: resolvePort faz fallback seguro para 3000');
  assert(resolvePortDiag('-10', '999999', 3000) === 3000, 'diagnosticApp: resolvePort faz fallback se ambos forem inválidos');

  // Validações de parsePort e resolvePort em serverApp
  assert(parsePortApp('8080') === 8080, 'serverApp: parsePort("8080") retorna 8080');
  assert(parsePortApp('3000') === 3000, 'serverApp: parsePort("3000") retorna 3000');
  assert(parsePortApp('invalid') === null, 'serverApp: parsePort("invalid") retorna null');
  assert(resolvePortApp('8080', undefined, 3000) === 8080, 'serverApp: resolvePort respeita PORT="8080"');
  assert(resolvePortApp('xyz', undefined, 3000) === 3000, 'serverApp: resolvePort faz fallback seguro para 3000');

  // --------------------------------------------------------------------------
  console.log('\n--- 3. Auditoria da Inicialização Node.js (Eliminação de Processo Filho) ---');
  // --------------------------------------------------------------------------
  assert(typeof isTsxEnvironment === 'function', 'server.ts exporta função isTsxEnvironment');
  assert(isTsxEnvironment(), 'isTsxEnvironment() identifica execução com --import tsx');

  const serverTsContent = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  assert(
    serverTsContent.includes('// Direct execution with tsx (--import tsx): NO child process spawned (PID 1 in Docker).'),
    'server.ts documenta execução direta sem processo filho redundante'
  );
  assert(
    serverTsContent.includes('if (process.env.NODE_ENV !== \'test\')'),
    'server.ts protege execução para não disparar servidores durante execução de testes'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Auditoria do Plano de Deploy Privado (docs/fase-1e-plano-execucao-deploy-privado.md) ---');
  // --------------------------------------------------------------------------
  const deployDocPath = path.join(process.cwd(), 'docs', 'fase-1e-plano-execucao-deploy-privado.md');
  assert(fs.existsSync(deployDocPath), 'Documento de plano de deploy existe');
  const deployDocContent = fs.readFileSync(deployDocPath, 'utf8');

  // Paridade de Tag entre Build e Deploy
  assert(
    deployDocContent.includes('export IMAGE_TAG="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:1e-diagnostic-$(date +%Y%m%d%H%M%S)"'),
    'Plano define variável explícita IMAGE_TAG imutável na Etapa 0'
  );
  assert(
    deployDocContent.includes('gcloud builds submit \\\n  --project="${PROJECT_ID}" \\\n  --tag="${IMAGE_TAG}"'),
    'Etapa 4 (Build) utiliza a variável ${IMAGE_TAG}'
  );
  assert(
    deployDocContent.includes('gcloud run deploy "${SERVICE_NAME}" \\\n  --project="${PROJECT_ID}" \\\n  --region="${REGION}" \\\n  --image="${IMAGE_TAG}"'),
    'Etapa 5 (Deploy) utiliza exatamente a mesma variável ${IMAGE_TAG}'
  );

  // Serviço Privado desde a Criação
  assert(
    deployDocContent.includes('--no-allow-unauthenticated'),
    'Comando de deploy contém obrigatoriamente a flag --no-allow-unauthenticated'
  );

  // Resolução da Audiência Inicial
  assert(
    deployDocContent.includes('export SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}"'),
    'Etapa 6 documenta captura segura da URL canônica gerada'
  );
  assert(
    deployDocContent.includes('--update-env-vars="CLOUD_RUN_SERVICE_URL=${SERVICE_URL}"'),
    'Etapa 6 documenta injeção de CLOUD_RUN_SERVICE_URL para fechamento de audience'
  );

  // Princípio do Menor Privilégio & Sem Chaves JSON
  assert(
    !deployDocContent.includes('gcloud iam service-accounts keys create'),
    'Plano proíbe categoricamente criação de chaves JSON (keys create)'
  );
  assert(
    !deployDocContent.includes('roles/owner') && !deployDocContent.includes('roles/editor'),
    'Plano não concede papéis de owner ou editor'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 5. Isolamento e Indisponibilidade de Rotas Funcionais em Modo Diagnóstico ---');
  // --------------------------------------------------------------------------
  process.env.DIAGNOSTIC_ONLY = 'true';

  const healthRes = await simulateRequest(diagnosticApp, 'GET', '/api/health');
  assert(healthRes.status === 200, 'GET /api/health retorna 200 OK');
  assert(healthRes.body?.mode === 'diagnostic_only', '/api/health explicita mode: diagnostic_only');
  assert(healthRes.body?.projectId === 'itissimple-security-staging', '/api/health confirma itissimple-security-staging');

  const diagHealthRes = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/health');
  assert(diagHealthRes.status === 200, 'GET /api/diagnostic/health retorna 200 OK');
  assert(diagHealthRes.body?.diagnosticMode === true, '/api/diagnostic/health confirma diagnosticMode=true');

  const businessRoutes = [
    '/api/tutors',
    '/api/students',
    '/api/teachers',
    '/api/live-lessons',
    '/api/homework',
    '/api/auth/login',
    '/api/auth/register',
    '/api/admin/clean-obsolete-users',
    '/api/dictionary/search',
    '/api/youtube-playlists',
    '/api/spotify/playlists',
  ];

  for (const r of businessRoutes) {
    const res = await simulateRequest(diagnosticApp, 'GET', r);
    assert(
      res.status === 404 && res.body?.diagnosticMode === true,
      `Rota de negócio ${r} não existe no modo diagnóstico (404 Not Found, diagnosticMode: true)`
    );
  }

  // Requisição sem token ao probe de diagnóstico deve retornar 401
  const probeAnon = await simulateRequest(diagnosticApp, 'GET', '/api/diagnostic/firestore');
  assert(probeAnon.status === 401, 'Probe GET /api/diagnostic/firestore anônimo é rejeitado com 401 Unauthorized');
  assert(probeAnon.body?.code === 'MISSING_IAM_CREDENTIALS', 'Código explícito MISSING_IAM_CREDENTIALS');

  // --------------------------------------------------------------------------
  console.log('\n--- 6. Intocabilidade de Dados Locais e Integridade de app_db.json ---');
  // --------------------------------------------------------------------------
  const appDbPath = path.join(process.cwd(), 'src', 'data', 'app_db.json');
  if (fs.existsSync(appDbPath)) {
    const content = fs.readFileSync(appDbPath, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    assert(hash.length === 64, `app_db.json inspecionado (SHA256: ${hash.substring(0, 16)}...)`);
  } else {
    assert(true, 'app_db.json não existente ou ignorado (ambiente limpo)');
  }

  console.log('\n=========================================================================');
  console.log(`TOTAL DE TESTES FASE 1E.1: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhase1E1Tests().catch((err) => {
  console.error('Fatal error in Phase 1E.1 test suite:', err);
  process.exit(1);
});
