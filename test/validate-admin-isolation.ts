import {
  getFirebaseAdminApp,
  getFirebaseAdminAuth,
  resolveProjectId,
  setFirebaseAdminAuthForTesting,
  setFirebaseAdminAppForTesting,
  resetFirebaseAdminForTesting,
  ALLOWED_STAGING_PROJECT_ID,
} from '../src/serverFirebaseAdmin';
import type { App } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';

let passed = 0;
let failed = 0;

function assert(condition: any, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

// Preserve initial process.env state
const initialFirebaseProjectId = process.env.FIREBASE_PROJECT_ID;
const initialGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
const initialGCloudProject = process.env.GCLOUD_PROJECT;

function restoreEnv() {
  if (initialFirebaseProjectId !== undefined) {
    process.env.FIREBASE_PROJECT_ID = initialFirebaseProjectId;
  } else {
    delete process.env.FIREBASE_PROJECT_ID;
  }

  if (initialGoogleCloudProject !== undefined) {
    process.env.GOOGLE_CLOUD_PROJECT = initialGoogleCloudProject;
  } else {
    delete process.env.GOOGLE_CLOUD_PROJECT;
  }

  if (initialGCloudProject !== undefined) {
    process.env.GCLOUD_PROJECT = initialGCloudProject;
  } else {
    delete process.env.GCLOUD_PROJECT;
  }
}

async function runTests() {
  console.log('\n=== INICIANDO BATERIA DE TESTES: ETAPA 3A (Isolamento do Firebase Admin) ===\n');

  try {
    // ---------------------------------------------------------
    // Cenário 1: Project ID correto
    // ---------------------------------------------------------
    console.log('--- 1. Testando Project ID correto (itissimple-security-staging) ---');
    {
      resetFirebaseAdminForTesting();
      process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';

      const resolved = resolveProjectId();
      assert(resolved === 'itissimple-security-staging', 'resolveProjectId() retorna exatamente itissimple-security-staging');
      assert(resolved === ALLOWED_STAGING_PROJECT_ID, 'resolveProjectId() corresponde à constante ALLOWED_STAGING_PROJECT_ID');

      // Validar mock App injetado no projeto correto
      const mockStagingApp: App = {
        name: '[DEFAULT]',
        options: { projectId: 'itissimple-security-staging' },
      };
      setFirebaseAdminAppForTesting(mockStagingApp);

      const app = getFirebaseAdminApp();
      assert(app === mockStagingApp, 'getFirebaseAdminApp() reutiliza com sucesso instância vinculada ao projeto staging autorizado');
      assert(app.options.projectId === 'itissimple-security-staging', 'Instância possui projectId itissimple-security-staging');
    }

    // ---------------------------------------------------------
    // Cenário 2: Variável ausente
    // ---------------------------------------------------------
    console.log('\n--- 2. Testando FIREBASE_PROJECT_ID ausente (rejeição estrita, sem fallbacks) ---');
    {
      resetFirebaseAdminForTesting();
      delete process.env.FIREBASE_PROJECT_ID;
      // Definir variáveis legadas para garantir que NÃO há fallback
      process.env.GOOGLE_CLOUD_PROJECT = '';
      process.env.GCLOUD_PROJECT = 'itissimple-security-staging';

      let resolveError: Error | null = null;
      try {
        resolveProjectId();
      } catch (err: any) {
        resolveError = err;
      }
      assert(resolveError !== null, 'resolveProjectId() lança erro quando FIREBASE_PROJECT_ID está ausente');
      assert(
        resolveError?.message.includes('FIREBASE_PROJECT_ID environment variable is missing') ||
        resolveError?.message.includes('missing'),
        'Mensagem de erro explicita ausência da variável de ambiente obrigatória'
      );

      let appError: Error | null = null;
      try {
        getFirebaseAdminApp();
      } catch (err: any) {
        appError = err;
      }
      assert(appError !== null, 'getFirebaseAdminApp() lança erro quando FIREBASE_PROJECT_ID está ausente');
      assert(
        appError?.message.includes('FIREBASE_PROJECT_ID environment variable is missing') ||
        appError?.message.includes('missing'),
        'getFirebaseAdminApp() recusa inicialização sem a variável de ambiente'
      );
    }

    // ---------------------------------------------------------
    // Cenário 3: Project ID antigo (itissimple-security-staging)
    // ---------------------------------------------------------
    console.log('\n--- 3. Testando Project ID antigo (itissimple-8663d bloqueado) ---');
    {
      resetFirebaseAdminForTesting();
      process.env.FIREBASE_PROJECT_ID = 'itissimple-8663d';

      let resolveError: Error | null = null;
      try {
        resolveProjectId();
      } catch (err: any) {
        resolveError = err;
      }
      assert(resolveError !== null, 'resolveProjectId() rejeita projeto antigo itissimple-8663d');
      assert(
        resolveError?.message.includes('Unauthorized Firebase project ID') &&
        resolveError?.message.includes('itissimple-8663d'),
        'Mensagem de erro explicita recusa do projeto itissimple-8663d'
      );

      let appError: Error | null = null;
      try {
        getFirebaseAdminApp();
      } catch (err: any) {
        appError = err;
      }
      assert(appError !== null, 'getFirebaseAdminApp() impede inicialização no projeto antigo');
      assert(
        appError?.message.includes('Unauthorized Firebase project ID') &&
        appError?.message.includes('itissimple-8663d'),
        'getFirebaseAdminApp() lança erro de não-autorizado para projeto antigo'
      );
    }

    // ---------------------------------------------------------
    // Cenário 4: Outro Project ID não autorizado
    // ---------------------------------------------------------
    console.log('\n--- 4. Testando outro Project ID arbitrário não autorizado ---');
    {
      resetFirebaseAdminForTesting();
      process.env.FIREBASE_PROJECT_ID = 'malicious-or-unknown-project-123';

      let resolveError: Error | null = null;
      try {
        resolveProjectId();
      } catch (err: any) {
        resolveError = err;
      }
      assert(resolveError !== null, 'resolveProjectId() rejeita ID de projeto desconhecido');
      assert(
        resolveError?.message.includes('malicious-or-unknown-project-123'),
        'Mensagem de erro cita o ID de projeto rejeitado'
      );

      let appError: Error | null = null;
      try {
        getFirebaseAdminApp();
      } catch (err: any) {
        appError = err;
      }
      assert(appError !== null, 'getFirebaseAdminApp() recusa ID de projeto arbitrário');
    }

    // ---------------------------------------------------------
    // Cenário 5: Instância previamente inicializada no projeto incorreto
    // ---------------------------------------------------------
    console.log('\n--- 5. Testando instância previamente inicializada no projeto incorreto ---');
    {
      // 5.1 Instância em cache pertencente ao projeto antigo itissimple-8663d
      resetFirebaseAdminForTesting();
      process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';

      const mockLegacyApp: App = {
        name: '[DEFAULT]',
        options: { projectId: 'itissimple-8663d' },
      };
      setFirebaseAdminAppForTesting(mockLegacyApp);

      let reuseError: Error | null = null;
      try {
        getFirebaseAdminApp();
      } catch (err: any) {
        reuseError = err;
      }
      assert(reuseError !== null, 'getFirebaseAdminApp() rejeita reutilizar instância em cache com projeto antigo itissimple-8663d');
      assert(
        reuseError?.message.includes('Existing cached Firebase Admin instance belongs to unauthorized project') &&
        reuseError?.message.includes('itissimple-8663d'),
        'Mensagem explicita que a instância em cache é de projeto não autorizado'
      );

      // 5.2 Instância em cache com projeto aleatório
      resetFirebaseAdminForTesting();
      const mockForeignApp: App = {
        name: 'foreign-app',
        options: { projectId: 'foreign-project-xyz' },
      };
      setFirebaseAdminAppForTesting(mockForeignApp);

      let foreignReuseError: Error | null = null;
      try {
        getFirebaseAdminApp();
      } catch (err: any) {
        foreignReuseError = err;
      }
      assert(foreignReuseError !== null, 'getFirebaseAdminApp() rejeita reutilizar instância em cache de projeto estrangeiro');
      assert(
        foreignReuseError?.message.includes('foreign-project-xyz'),
        'Mensagem cita projeto estrangeiro em cache'
      );

      // 5.3 Instância em cache sem projectId definido em options
      resetFirebaseAdminForTesting();
      const mockUndefApp: App = {
        name: 'undef-app',
        options: {},
      };
      setFirebaseAdminAppForTesting(mockUndefApp);

      let undefReuseError: Error | null = null;
      try {
        getFirebaseAdminApp();
      } catch (err: any) {
        undefReuseError = err;
      }
      assert(undefReuseError !== null, 'getFirebaseAdminApp() rejeita reutilizar instância em cache sem projectId definido');
    }

    // ---------------------------------------------------------
    // Cenário 6: Preservação das funções e interfaces existentes
    // ---------------------------------------------------------
    console.log('\n--- 6. Testando preservação das exportações e interfaces existentes ---');
    {
      assert(typeof getFirebaseAdminApp === 'function', 'getFirebaseAdminApp é uma função');
      assert(typeof getFirebaseAdminAuth === 'function', 'getFirebaseAdminAuth é uma função');
      assert(typeof setFirebaseAdminAuthForTesting === 'function', 'setFirebaseAdminAuthForTesting é uma função');

      // Testando injeção de mock Auth via setFirebaseAdminAuthForTesting
      let verifyIdTokenCalled = false;
      const mockAuth: Partial<Auth> = {
        verifyIdToken: async (token: string) => {
          verifyIdTokenCalled = true;
          return { uid: 'user-staging-test', email: 'test@example.com', role: 'teacher' } as any;
        },
      };

      setFirebaseAdminAuthForTesting(mockAuth as Auth);
      const auth = getFirebaseAdminAuth();
      assert(auth === mockAuth, 'getFirebaseAdminAuth() retorna mock Auth injetado via setFirebaseAdminAuthForTesting');

      const verified = await auth.verifyIdToken('sample-token');
      assert(verifyIdTokenCalled, 'Mock Auth verifyIdToken foi invocado com sucesso');
      assert(verified.uid === 'user-staging-test', 'Mock Auth retornou token verificado');

      // Limpar mock Auth
      setFirebaseAdminAuthForTesting(null);
      resetFirebaseAdminForTesting();
    }

    // ---------------------------------------------------------
    // Cenário 7: Não mascarar falhas
    // ---------------------------------------------------------
    console.log('\n--- 7. Testando ausência de mascaramento de falhas ---');
    {
      resetFirebaseAdminForTesting();
      process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';

      // Sem ADC ou mock, getFirebaseAdminAuth deve invocar getFirebaseAdminApp
      // que tenta inicializar e falha explicitamente se credenciais ADC não estiverem disponíveis,
      // sem mascarar como sucesso
      let errorThrown = false;
      try {
        // Mock app que falha
        const brokenApp: App = {
          name: 'broken',
          options: { projectId: 'unauthorized-test' },
        };
        setFirebaseAdminAppForTesting(brokenApp);
        getFirebaseAdminAuth();
      } catch {
        errorThrown = true;
      }
      assert(errorThrown, 'getFirebaseAdminAuth() propaga exceções de validação de app sem mascarar');
    }

  } finally {
    restoreEnv();
    resetFirebaseAdminForTesting();
  }

  console.log(`\n========================================`);
  console.log(`TOTAL DE TESTES ISOLAMENTO: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro na execução dos testes de isolamento:', err);
  process.exit(1);
});
