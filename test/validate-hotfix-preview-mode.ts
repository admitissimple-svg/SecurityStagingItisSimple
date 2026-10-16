process.env.NODE_ENV = 'test';
import assert from 'assert';

async function main() {
  const { isProductionMode, isCloudRunPreviewEnvironment } = await import('../serverApp');

  console.log('Testing isCloudRunPreviewEnvironment and isProductionMode...');

  // Caso 1: NODE_ENV=production explícito
  process.env.NODE_ENV = 'production';
  delete process.env.K_SERVICE;
  delete process.env.K_REVISION;
  delete process.env.APP_ENV;
  assert.strictEqual(isProductionMode(), true, 'Caso 1: NODE_ENV=production');
  console.log('  ✅ PASS: Caso 1 (NODE_ENV=production)');

  // Caso 2: Cloud Run runtime com K_SERVICE e SEM NODE_ENV (produção staging)
  delete process.env.NODE_ENV;
  process.env.K_SERVICE = 'itissimplesecuritystaging';
  delete process.env.K_REVISION;
  delete process.env.APP_ENV;
  assert.strictEqual(isProductionMode(), true, 'Caso 2: K_SERVICE produção');
  console.log('  ✅ PASS: Caso 2 (K_SERVICE produção)');

  // Caso 3: Cloud Run runtime com K_REVISION e SEM NODE_ENV (produção staging)
  delete process.env.NODE_ENV;
  delete process.env.K_SERVICE;
  process.env.K_REVISION = 'itissimplesecuritystaging-00001-abc';
  assert.strictEqual(isProductionMode(), true, 'Caso 3: K_REVISION produção');
  console.log('  ✅ PASS: Caso 3 (K_REVISION produção)');

  // Caso 4: APP_ENV=production explícito
  delete process.env.NODE_ENV;
  delete process.env.K_SERVICE;
  delete process.env.K_REVISION;
  process.env.APP_ENV = 'production';
  assert.strictEqual(isProductionMode(), true, 'Caso 4: APP_ENV=production');
  console.log('  ✅ PASS: Caso 4 (APP_ENV=production)');

  // Caso 5: Ambiente local sem variáveis
  delete process.env.NODE_ENV;
  delete process.env.K_SERVICE;
  delete process.env.K_REVISION;
  delete process.env.APP_ENV;
  delete process.env.APPLET_ID;
  assert.strictEqual(isProductionMode(), false, 'Caso 5: sem variáveis');
  console.log('  ✅ PASS: Caso 5 (Ambiente sem variáveis)');

  // Caso 6: NODE_ENV=development explícito
  process.env.NODE_ENV = 'development';
  assert.strictEqual(isProductionMode(), false, 'Caso 6: NODE_ENV=development');
  console.log('  ✅ PASS: Caso 6 (NODE_ENV=development)');

  // Caso 7: Cloud Run Preview (ais-dev) mesmo sem NODE_ENV
  delete process.env.NODE_ENV;
  process.env.K_SERVICE = 'ais-dev-4gl2mvotjfzqppuk46htpv';
  process.env.K_REVISION = 'ais-dev-4gl2mvotjfzqppuk46htpv-00004-tmb';
  assert.strictEqual(isCloudRunPreviewEnvironment(), true, 'Caso 7 isPreview');
  assert.strictEqual(isProductionMode(), false, 'Caso 7 isProductionMode deve ser false');
  console.log('  ✅ PASS: Caso 7 (Cloud Run Preview ais-dev detectado como dev)');

  // Caso 8: Cloud Run Preview (ais-pre) mesmo sem NODE_ENV
  delete process.env.NODE_ENV;
  process.env.K_SERVICE = 'ais-pre-4gl2mvotjfzqppuk46htpv';
  process.env.K_REVISION = 'ais-pre-4gl2mvotjfzqppuk46htpv-00001';
  assert.strictEqual(isCloudRunPreviewEnvironment(), true, 'Caso 8 isPreview');
  assert.strictEqual(isProductionMode(), false, 'Caso 8 isProductionMode deve ser false');
  console.log('  ✅ PASS: Caso 8 (Cloud Run Preview ais-pre detectado como dev)');

  // Caso 9: Cloud Run com 'preview' no nome do serviço
  delete process.env.NODE_ENV;
  process.env.K_SERVICE = 'my-feature-preview';
  delete process.env.K_REVISION;
  assert.strictEqual(isCloudRunPreviewEnvironment(), true, 'Caso 9 isPreview');
  assert.strictEqual(isProductionMode(), false, 'Caso 9 isProductionMode deve ser false');
  console.log('  ✅ PASS: Caso 9 (K_SERVICE com preview detectado como dev)');

  // Caso 10: Cloud Run com 'dev' no nome do serviço
  delete process.env.NODE_ENV;
  process.env.K_SERVICE = 'itissimple-dev-service';
  delete process.env.K_REVISION;
  assert.strictEqual(isCloudRunPreviewEnvironment(), true, 'Caso 10 isPreview');
  assert.strictEqual(isProductionMode(), false, 'Caso 10 isProductionMode deve ser false');
  console.log('  ✅ PASS: Caso 10 (K_SERVICE com dev detectado como dev)');

  // Caso 11: Cloud Run Preview com NODE_ENV=development
  process.env.NODE_ENV = 'development';
  process.env.K_SERVICE = 'ais-dev-4gl2mvotjfzqppuk46htpv';
  assert.strictEqual(isProductionMode(), false, 'Caso 11: NODE_ENV=development em Cloud Run Preview');
  console.log('  ✅ PASS: Caso 11 (NODE_ENV=development em Cloud Run Preview não é forçado para produção)');

  console.log('\n🎉 TODOS OS TESTES DE DETECÇÃO DE MODO PASSARAM COM SUCESSO!');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Falha:', err);
  process.exit(1);
});
