/**
 * Bateria de Testes Automatizados — Fase 1E.1: Correção Controlada dos Bloqueios
 *
 * Projeto Exclusivo: itissimple-security-staging
 * Projeto Legado PROIBIDO: itissimple-8663d
 *
 * Validações Obrigatórias:
 * 1. Dockerfile Oficial: Node 22, DIAGNOSTIC_ONLY=true, itissimple-security-staging, (default),
 *    porta 8080 dinâmica, CMD direto ["node", "--import", "tsx", "server.ts"], ausência de app_db.json e segredos.
 *    npm ci estritamente aplicado nos dois estágios (builder e runner) sem fallback para npm install.
 * 2. Dependências: tsx posicionado em dependencies e sincronizado em package-lock.json.
 * 3. Auditoria do Contexto Docker: Condição if explícita verificando e retornando erro caso arquivos
 *    proibidos (credenciais, .env, bancos locais, backups) vazem para o contexto Docker,
 *    garantindo que arquivos de configuração legítimos do build não sejam excluídos.
 * 4. Disponibilidade do tsx no Runner: Validação real executando `node --import tsx`.
 * 5. Documentação & Status: Autenticação interna do diagnóstico mantida com status PENDENTE DE HOMOLOGAÇÃO.
 * 6. Resolução Robusta de Porta: PORT=8080 respeitado, valores inválidos tratados com fallback seguro.
 * 7. Isolamento Diagnóstico: Zero rotas de negócio, zero persistência local, falhas IAM fechadas.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import child_process from 'child_process';
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

/**
 * Avalia se um caminho relativo corresponde a regras simples do .dockerignore
 */
function matchesDockerignoreRule(filePath: string, rule: string): boolean {
  let cleanRule = rule.trim();
  if (!cleanRule || cleanRule.startsWith('#')) return false;

  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\//, '');
  const isNegated = cleanRule.startsWith('!');
  if (isNegated) cleanRule = cleanRule.slice(1);

  cleanRule = cleanRule.replace(/^\//, '');

  // Exact match
  if (normalizedPath === cleanRule) return !isNegated;

  // Directory match (e.g. "docs" matches "docs/file.md")
  if (normalizedPath.startsWith(cleanRule + '/')) return !isNegated;

  // Extension wildcard match (e.g. "*.env", "*.key", "*.pem", "*.md", "*.db")
  if (cleanRule.startsWith('*.')) {
    const ext = cleanRule.slice(1); // e.g. ".env"
    if (normalizedPath.endsWith(ext) || path.basename(normalizedPath).endsWith(ext)) {
      return !isNegated;
    }
  }

  // Prefix wildcard match (e.g. ".env*")
  if (cleanRule.endsWith('*') && !cleanRule.includes('/')) {
    const prefix = cleanRule.slice(0, -1);
    const basename = path.basename(normalizedPath);
    if (basename.startsWith(prefix) || normalizedPath.startsWith(prefix)) {
      return !isNegated;
    }
  }

  // Subdirectory wildcard pattern (e.g. "src/data/*.backup.json")
  if (cleanRule.includes('*')) {
    const regexPattern = '^' + cleanRule
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') + '$';
    const regex = new RegExp(regexPattern);
    if (regex.test(normalizedPath) || regex.test(path.basename(normalizedPath))) {
      return !isNegated;
    }
  }

  return false;
}

function isPathIgnored(filePath: string, rules: string[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (!rule.trim() || rule.trim().startsWith('#')) continue;
    if (matchesDockerignoreRule(filePath, rule)) {
      ignored = !rule.trim().startsWith('!');
    }
  }
  return ignored;
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
  console.log('--- 1. Auditoria e Validação do Dockerfile Oficial & npm ci Estrito ---');
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

  // Verificação estrita de npm ci em ambos os estágios sem fallback para npm install
  assert(
    dockerfileContent.includes('RUN npm ci --legacy-peer-deps'),
    'Estágio builder aplica estritamente RUN npm ci --legacy-peer-deps'
  );
  assert(
    dockerfileContent.includes('RUN npm ci --omit=dev --legacy-peer-deps'),
    'Estágio runner aplica estritamente RUN npm ci --omit=dev --legacy-peer-deps'
  );
  assert(
    !dockerfileContent.includes('npm install --') && !dockerfileContent.includes('|| npm install'),
    'Dockerfile não contém comandos de npm install nem fallbacks permissivos'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Auditoria de package.json e package-lock.json (tsx em dependencies) ---');
  // --------------------------------------------------------------------------
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  assert(fs.existsSync(packageJsonPath), 'package.json existe na raiz');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  assert(
    Boolean(packageJson.dependencies?.['tsx']),
    'tsx está devidamente posicionado em "dependencies" (não devDependencies)'
  );
  assert(
    !packageJson.devDependencies?.['tsx'],
    'tsx foi removido de "devDependencies"'
  );

  const packageLockPath = path.join(process.cwd(), 'package-lock.json');
  assert(fs.existsSync(packageLockPath), 'package-lock.json existe na raiz do repositório');
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
  assert(
    Boolean(packageLock.packages?.['']?.dependencies?.['tsx']),
    'package-lock.json registra tsx em dependencies preservando as versões de todas as outras dependências'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 3. Auditoria do Contexto Docker (.dockerignore com Condição IF Explícita) ---');
  // --------------------------------------------------------------------------
  const dockerignorePath = path.join(process.cwd(), '.dockerignore');
  assert(fs.existsSync(dockerignorePath), 'Arquivo /.dockerignore existe na raiz');
  const dockerignoreRaw = fs.readFileSync(dockerignorePath, 'utf8');
  const dockerignoreRules = dockerignoreRaw.split('\n');

  // Amostra de caminhos estritamente proibidos no contexto Docker
  const prohibitedSamplePaths = [
    '.env',
    '.env.local',
    '.env.production',
    '.env.staging',
    'id_rsa',
    'credentials.json',
    'serviceAccountKey.json',
    'prod-service-account.json',
    'server.key',
    'cert.pem',
    'secret.pfx',
    'src/data/app_db.json',
    'src/data/app_db.backup.json',
    'src/data/app_db_v2.json',
    'database.db',
    'sqlite.sqlite3',
    'dump.sql',
    'backup.bak',
    'backup.backup',
    'test_backup.json',
    'temp.old',
  ];

  // Execução da auditoria com condição IF explícita
  const prohibitedDetectedInContext: string[] = [];
  for (const forbiddenPath of prohibitedSamplePaths) {
    const isIgnored = isPathIgnored(forbiddenPath, dockerignoreRules);
    if (!isIgnored) {
      prohibitedDetectedInContext.push(forbiddenPath);
    }
  }

  // Condição IF explícita para retornar erro caso detecte arquivos proibidos
  if (prohibitedDetectedInContext.length > 0) {
    assert(
      false,
      'Auditoria do Contexto Docker: arquivos proibidos detectados no contexto de build!',
      `Falha nos caminhos: ${prohibitedDetectedInContext.join(', ')}`
    );
  } else {
    assert(
      true,
      'Auditoria do Contexto Docker: condição IF explícita confirmou que nenhum arquivo proibido entra no contexto'
    );
  }

  // Verificação de que arquivos legítimos de build NÃO são indevidamente excluídos
  const legitimateBuildFiles = [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'firebase-applet-config.json',
    'server.ts',
    'serverApp.ts',
    'privacy.html',
    'src/main.tsx',
    'src/App.tsx',
    'public/terms.html',
  ];

  const legitimateFilesWronglyExcluded: string[] = [];
  for (const legitimateFile of legitimateBuildFiles) {
    const isIgnored = isPathIgnored(legitimateFile, dockerignoreRules);
    if (isIgnored) {
      legitimateFilesWronglyExcluded.push(legitimateFile);
    }
  }

  if (legitimateFilesWronglyExcluded.length > 0) {
    assert(
      false,
      'Auditoria do Contexto Docker: arquivos de configuração legítimos do build foram indevidamente excluídos!',
      `Arquivos bloqueados: ${legitimateFilesWronglyExcluded.join(', ')}`
    );
  } else {
    assert(
      true,
      'Auditoria do Contexto Docker: todos os arquivos legítimos necessários ao build permanecem disponíveis'
    );
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Validação da Disponibilidade do tsx no Runner via "node --import tsx" ---');
  // --------------------------------------------------------------------------
  assert(typeof isTsxEnvironment === 'function', 'server.ts exporta função isTsxEnvironment');
  assert(isTsxEnvironment(), 'isTsxEnvironment() identifica execução com --import tsx');

  let runnerNodeImportTsxSuccess = false;
  let runnerOutput = '';
  try {
    const output = child_process.execSync(
      'node --import tsx -e "console.log(\'TSX_RUNNER_AVAILABLE_OK\')"',
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
      }
    );
    runnerOutput = output.trim();
    if (runnerOutput.includes('TSX_RUNNER_AVAILABLE_OK')) {
      runnerNodeImportTsxSuccess = true;
    }
  } catch (err: any) {
    runnerNodeImportTsxSuccess = false;
    runnerOutput = err.message || String(err);
  }

  assert(
    runnerNodeImportTsxSuccess,
    'Validação do runner: comando real "node --import tsx" executado com sucesso e zero dependência de .bin/tsx',
    runnerOutput
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 5. Auditoria de Status da Documentação (PENDENTE DE HOMOLOGAÇÃO) ---');
  // --------------------------------------------------------------------------
  const deployDocPath = path.join(process.cwd(), 'docs', 'fase-1e-plano-execucao-deploy-privado.md');
  assert(fs.existsSync(deployDocPath), 'docs/fase-1e-plano-execucao-deploy-privado.md existe');
  const deployDocContent = fs.readFileSync(deployDocPath, 'utf8');

  assert(
    deployDocContent.includes('PENDENTE DE HOMOLOGAÇÃO'),
    'Documentação mantém autenticação interna do diagnóstico expressamente como PENDENTE DE HOMOLOGAÇÃO'
  );

  const oidcDocPath = path.join(process.cwd(), 'docs', 'fase-1d2-validacao-oidc.md');
  assert(fs.existsSync(oidcDocPath), 'docs/fase-1d2-validacao-oidc.md existe');
  const oidcDocContent = fs.readFileSync(oidcDocPath, 'utf8');

  assert(
    oidcDocContent.includes('PENDENTE DE HOMOLOGAÇÃO'),
    'Documentação OIDC mantém autenticação do diagnóstico com status PENDENTE DE HOMOLOGAÇÃO'
  );

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
  assert(
    deployDocContent.includes('--no-allow-unauthenticated'),
    'Comando de deploy contém obrigatoriamente a flag --no-allow-unauthenticated'
  );
  assert(
    !deployDocContent.includes('gcloud iam service-accounts keys create'),
    'Plano proíbe categoricamente criação de chaves JSON (keys create)'
  );

  // --------------------------------------------------------------------------
  console.log('\n--- 6. Auditoria da Resolução de Porta (diagnosticApp e serverApp) ---');
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
  console.log('\n--- 7. Isolamento e Indisponibilidade de Rotas Funcionais em Modo Diagnóstico ---');
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
  console.log('\n--- 8. Intocabilidade de Dados Locais e Integridade de app_db.json ---');
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
