/**
 * ==============================================================================
 * TESTE DE VALIDAÇÃO: HOTFIX CLOUD RUN — INICIALIZAÇÃO EM PRODUÇÃO
 * Serviço: itissimplesecuritystaging
 * Projeto: itissimple-security-staging (us-east1)
 * ==============================================================================
 */

import assert from 'assert';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
process.env.NODE_ENV = 'test';

async function waitHttp(url: string, timeoutMs = 8000): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
        const req = http.get(url, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve({ status: res.statusCode || 0, body: data, headers: res.headers });
          });
        });
        req.on('error', reject);
        req.setTimeout(1500, () => {
          req.destroy(new Error('Timeout'));
        });
      });
      return res;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Timeout waiting for ${url} after ${timeoutMs}ms`);
}

async function runTests() {
  const { isProductionMode, parsePort, resolvePort } = await import('../serverApp');
  console.log('============================================================================');
  console.log(" TESTE DE VALIDAÇÃO: HOTFIX INICIALIZAÇÃO CLOUD RUN EM PRODUÇÃO             ");
  console.log(" Projeto: itissimple-security-staging | Serviço: itissimplesecuritystaging  ");
  console.log('============================================================================\n');

  // --------------------------------------------------------------------------
  console.log('--- 1. Auditoria da Função isProductionMode() (Fonte Única da Verdade) ---');
  // --------------------------------------------------------------------------
  const originalEnv = { ...process.env };

  try {
    // Caso 1: NODE_ENV=production explícito
    process.env.NODE_ENV = 'production';
    delete process.env.K_SERVICE;
    delete process.env.K_REVISION;
    delete process.env.APP_ENV;
    assert.strictEqual(isProductionMode(), true, 'NODE_ENV=production é identificado como produção');
    console.log('  ✅ PASS: NODE_ENV=production é identificado como produção');

    // Caso 2: Cloud Run runtime com K_SERVICE e SEM NODE_ENV
    delete process.env.NODE_ENV;
    process.env.K_SERVICE = 'itissimplesecuritystaging';
    delete process.env.K_REVISION;
    delete process.env.APP_ENV;
    assert.strictEqual(isProductionMode(), true, 'K_SERVICE presente sem NODE_ENV é identificado como produção');
    console.log('  ✅ PASS: K_SERVICE em Cloud Run é identificado como produção mesmo sem NODE_ENV');

    // Caso 3: Cloud Run runtime com K_REVISION e SEM NODE_ENV
    delete process.env.NODE_ENV;
    delete process.env.K_SERVICE;
    process.env.K_REVISION = 'itissimplesecuritystaging-00001-abc';
    assert.strictEqual(isProductionMode(), true, 'K_REVISION presente sem NODE_ENV é identificado como produção');
    console.log('  ✅ PASS: K_REVISION em Cloud Run é identificado como produção mesmo sem NODE_ENV');

    // Caso 4: APP_ENV=production explícito
    delete process.env.NODE_ENV;
    delete process.env.K_SERVICE;
    delete process.env.K_REVISION;
    process.env.APP_ENV = 'production';
    assert.strictEqual(isProductionMode(), true, 'APP_ENV=production é identificado como produção');
    console.log('  ✅ PASS: APP_ENV=production é identificado como produção');

    // Caso 5: Ambiente de desenvolvimento local (sem NODE_ENV e sem Cloud Run)
    delete process.env.NODE_ENV;
    delete process.env.K_SERVICE;
    delete process.env.K_REVISION;
    delete process.env.APP_ENV;
    assert.strictEqual(isProductionMode(), false, 'Ambiente sem variáveis é desenvolvimento (NÃO assume produção)');
    console.log('  ✅ PASS: Ambiente local sem NODE_ENV NÃO assume produção (preserva desenvolvimento)');

    // Caso 6: NODE_ENV=development explícito
    process.env.NODE_ENV = 'development';
    assert.strictEqual(isProductionMode(), false, 'NODE_ENV=development é identificado como desenvolvimento');
    console.log('  ✅ PASS: NODE_ENV=development é identificado como desenvolvimento');
  } finally {
    process.env = { ...originalEnv };
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Auditoria de Isolamento do Vite em Modo Produção ---');
  // --------------------------------------------------------------------------
  const serverAppContent = fs.readFileSync(path.join(process.cwd(), 'serverApp.ts'), 'utf-8');
  assert.strictEqual(
    serverAppContent.includes("import { createServer as createViteServer } from 'vite';"),
    false,
    'serverApp.ts NÃO deve ter import estático de createViteServer no topo do arquivo'
  );
  console.log('  ✅ PASS: createViteServer NÃO é importado estaticamente no topo de serverApp.ts');

  assert.strictEqual(
    serverAppContent.includes("await import('vite')"),
    true,
    'serverApp.ts usa import dinâmico assíncrono para isolar o Vite de desenvolvimento'
  );
  console.log('  ✅ PASS: Vite é isolado via import dinâmico assíncrono exclusivamente no bloco de desenvolvimento');

  // --------------------------------------------------------------------------
  console.log('\n--- 3. Verificação dos Artefatos Estáticos Compilados (dist/) ---');
  // --------------------------------------------------------------------------
  const distPath = path.join(process.cwd(), 'dist');
  assert.strictEqual(fs.existsSync(distPath), true, 'Diretório dist/ existe após build');
  assert.strictEqual(fs.existsSync(path.join(distPath, 'index.html')), true, 'dist/index.html existe');
  console.log('  ✅ PASS: Diretório dist/ e dist/index.html confirmados com sucesso');

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Teste de Inicialização Real em Ambiente Equivalente ao Cloud Run ---');
  // --------------------------------------------------------------------------
  const testPort = 3199;
  let serverLogs = '';

  const cloudRunEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'NODE_ENV') {
      cloudRunEnv[k] = v;
    }
  }
  cloudRunEnv.PORT = String(testPort);
  cloudRunEnv.K_SERVICE = 'itissimplesecuritystaging';
  cloudRunEnv.K_REVISION = 'itissimplesecuritystaging-00001-xyz';
  cloudRunEnv.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
  cloudRunEnv.FIREBASE_DATABASE_ID = '(default)';

  const cloudRunProcess = spawn(
    'node',
    ['--import', 'tsx', 'server.ts'],
    {
      cwd: process.cwd(),
      env: cloudRunEnv,
    }
  );

  cloudRunProcess.stdout?.on('data', (d) => {
    serverLogs += d.toString();
  });
  cloudRunProcess.stderr?.on('data', (d) => {
    serverLogs += d.toString();
  });

  try {
    console.log(`  ... aguardando inicialização do servidor Cloud Run na porta ${testPort}...`);
    const healthRes = await waitHttp(`http://127.0.0.1:${testPort}/api/health`, 9000);
    assert.strictEqual(healthRes.status, 200, `Health check HTTP 200 na porta ${testPort}`);
    const healthJson = JSON.parse(healthRes.body);
    assert.strictEqual(healthJson.status, 'ok', 'Status ok no health check');
    console.log(`  ✅ PASS: Startup TCP probe na porta ${testPort} respondeu HTTP 200 imediatamente`);

    // Testa se o frontend estático compilado é servido corretamente na raiz
    const rootRes = await waitHttp(`http://127.0.0.1:${testPort}/`);
    assert.strictEqual(rootRes.status, 200, 'GET / retorna HTTP 200');
    assert.strictEqual(rootRes.body.includes('<!doctype html>'), true, 'GET / serve index.html compilado');
    console.log('  ✅ PASS: GET / serve o frontend compilado (dist/index.html)');

    // Testa rota de fallback SPA
    const spaRes = await waitHttp(`http://127.0.0.1:${testPort}/learn/routines`);
    assert.strictEqual(spaRes.status, 200, 'GET /learn/routines retorna HTTP 200 via fallback SPA');
    assert.strictEqual(spaRes.body.includes('<!doctype html>'), true, 'Fallback SPA serve index.html');
    console.log('  ✅ PASS: Rota SPA desconhecida retorna index.html compilado (SPA fallback)');

    // Testa que rota /api/* inexistente retorna 404 JSON e NÃO index.html
    const api404Res = await waitHttp(`http://127.0.0.1:${testPort}/api/unknown-endpoint-probe`);
    assert.strictEqual(api404Res.status, 404, 'GET /api/unknown... retorna HTTP 404');
    assert.strictEqual(api404Res.body.includes('<!doctype html>'), false, 'GET /api/* não serve HTML');
    console.log('  ✅ PASS: Rota /api/* inexistente retorna 404 JSON sem vazar SPA HTML');

    // Verifica que o log indicou modo de PRODUÇÃO e NÃO modo de desenvolvimento
    assert.strictEqual(
      serverLogs.includes('[Server] Running in PRODUCTION mode'),
      true,
      'Log do servidor confirma execução em modo de PRODUÇÃO'
    );
    assert.strictEqual(
      serverLogs.includes('[Server] Running in DEVELOPMENT mode'),
      false,
      'Log do servidor NÃO deve registrar modo de desenvolvimento'
    );
    console.log('  ✅ PASS: Log confirma execução em modo PRODUCTION e ausência de Vite dev');
  } finally {
    cloudRunProcess.kill('SIGTERM');
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 5. Teste de Inicialização em Modo DIAGNOSTIC_ONLY ---');
  // --------------------------------------------------------------------------
  const diagPort = 3198;
  let diagLogs = '';
  const diagEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'NODE_ENV') {
      diagEnv[k] = v;
    }
  }
  diagEnv.PORT = String(diagPort);
  diagEnv.DIAGNOSTIC_ONLY = 'true';
  diagEnv.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
  diagEnv.FIREBASE_DATABASE_ID = '(default)';

  const diagProcess = spawn(
    'node',
    ['--import', 'tsx', 'server.ts'],
    {
      cwd: process.cwd(),
      env: diagEnv,
    }
  );

  diagProcess.stdout?.on('data', (d) => {
    diagLogs += d.toString();
  });
  diagProcess.stderr?.on('data', (d) => {
    diagLogs += d.toString();
  });

  try {
    console.log(`  ... aguardando inicialização do modo diagnóstico na porta ${diagPort}...`);
    const diagHealthRes = await waitHttp(`http://127.0.0.1:${diagPort}/api/health`, 8000);
    assert.strictEqual(diagHealthRes.status, 200, 'Health check diagnóstico HTTP 200');
    const diagJson = JSON.parse(diagHealthRes.body);
    assert.strictEqual(diagJson.mode, 'diagnostic_only', 'Modo diagnóstico confirmado no payload');
    console.log('  ✅ PASS: Servidor inicia corretamente em modo DIAGNOSTIC_ONLY');
  } catch (err) {
    console.error('Diag process logs:\n', diagLogs);
    throw err;
  } finally {
    diagProcess.kill('SIGTERM');
  }

  console.log('\n============================================================================');
  console.log(' TODOS OS TESTES DO HOTFIX CLOUD RUN PASSARAM COM SUCESSO!                 ');
  console.log('============================================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ FALHA NO TESTE DE VALIDAÇÃO DO HOTFIX:', err);
  process.exit(1);
});
