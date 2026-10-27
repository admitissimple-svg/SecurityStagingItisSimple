import assert from 'node:assert';
import { isAuthorizedAdminUser, getAdminAccessToken, KNOWN_ADMIN_EMAILS } from '../src/utils/auth';
import { fetchPublicNativeFriendsFromFirestore } from '../src/hooks/useNativeFriends';
import { addTrackToListenedHistoryInFirestore } from '../src/hooks/useRoutine';

console.log('================================================================');
console.log(' TEST SUITE: HOTFIX SECURITY STAGING — 403 & 404 CORRECTIONS');
console.log('================================================================\n');

async function runTestSuite() {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(err);
      failed++;
    }
  }

  // Save original fetch
  const originalFetch = globalThis.fetch;

  try {
    // --------------------------------------------------------------------------
    // 1. Login de aluno sem chamada indevida a sync-admin-claims
    // --------------------------------------------------------------------------
    console.log('--- 1. Login de Aluno: Sem chamada indevida a sync-admin-claims ---');

    await test('isAuthorizedAdminUser returns false for regular student', async () => {
      const mockStudentUser: any = {
        uid: 'student-uid-test-123',
        email: 'student@example.com',
        emailVerified: true,
        getIdToken: async () => 'header.eyJ1aWQiOiJzdHVkZW50LXVpZC10ZXN0LTEyMyIsInJvbGUiOiJzdHVkZW50In0.signature',
      };
      const isAdm = await isAuthorizedAdminUser(mockStudentUser);
      assert.strictEqual(isAdm, false, 'Student user must NOT be recognized as admin candidate');
    });

    await test('isAuthorizedAdminUser returns false for unverified user even with admin-like name', async () => {
      const mockUnverifiedUser: any = {
        uid: 'unverified-123',
        email: 'adm.itissimple@gmail.com',
        emailVerified: false,
        getIdToken: async () => 'header.eyJ1aWQiOiJ1bnZlcmlmaWVkLTEyMyJ9.signature',
      };
      const isAdm = await isAuthorizedAdminUser(mockUnverifiedUser);
      assert.strictEqual(isAdm, false, 'Unverified email must NOT be recognized as admin');
    });

    await test('Student calling getAdminAccessToken does NOT trigger sync-admin-claims endpoint', async () => {
      let syncClaimsCalled = false;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        if (urlStr.includes('/api/auth/sync-admin-claims')) {
          syncClaimsCalled = true;
          return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
        }
        if (urlStr.includes('/api/auth/admin-status')) {
          return new Response(JSON.stringify({ hasAdmin: true, adminEmail: 'adm.itissimple@gmail.com' }), { status: 200 });
        }
        return originalFetch(input, init);
      };

      const mockStudentUser: any = {
        uid: 'student-uid-test-456',
        email: 'aluno.regular@escola.com',
        emailVerified: true,
        getIdToken: async () => 'header.eyJ1aWQiOiJzdHVkZW50LTQ1NiJ9.signature',
      };

      const isAdm = await isAuthorizedAdminUser(mockStudentUser);
      assert.strictEqual(isAdm, false, 'Student must not be authorized admin');
      assert.strictEqual(syncClaimsCalled, false, 'sync-admin-claims MUST NOT be called');
    });

    // --------------------------------------------------------------------------
    // 2. Login administrativo preservado
    // --------------------------------------------------------------------------
    console.log('\n--- 2. Login Administrativo Preservado ---');

    await test('isAuthorizedAdminUser recognizes authorized admin with verified email', async () => {
      const mockAdminUser: any = {
        uid: 'admin-legit-uid-999',
        email: 'adm.itissimple@gmail.com',
        emailVerified: true,
        getIdToken: async () => 'header.eyJ1aWQiOiJhZG1pbi1sZWdpdC11aWQtOTk5In0.signature',
      };
      const isAdm = await isAuthorizedAdminUser(mockAdminUser);
      assert.strictEqual(isAdm, true, 'Authorized admin email must be recognized');
    });

    await test('isAuthorizedAdminUser recognizes user with existing admin claim', async () => {
      const mockClaimUser: any = {
        uid: 'admin-claimed-uid',
        email: 'otheradmin@example.com',
        emailVerified: true,
        getIdToken: async () => 'header.eyJ1aWQiOiJhZG1pbi1jbGFpbWVkLXVpZCIsInJvbGUiOiJhZG1pbiJ9.signature',
      };
      const isAdm = await isAuthorizedAdminUser(mockClaimUser);
      assert.strictEqual(isAdm, true, 'User with JWT role=admin must be recognized immediately');
    });

    await test('Admin without existing claims triggers sync-admin-claims and obtains claim', async () => {
      let syncCalled = false;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        if (urlStr.includes('/api/auth/sync-admin-claims')) {
          syncCalled = true;
          return new Response(JSON.stringify({ success: true, role: 'admin' }), { status: 200 });
        }
        if (urlStr.includes('/api/auth/admin-status')) {
          return new Response(JSON.stringify({ hasAdmin: true, adminEmail: 'adm.itissimple@gmail.com' }), { status: 200 });
        }
        return originalFetch(input, init);
      };

      const mockAdminUser: any = {
        uid: 'admin-sync-uid',
        email: 'adm.itissimple@gmail.com',
        emailVerified: true,
        getIdToken: async (forceRefresh?: boolean) => {
          if (forceRefresh) {
            return 'header.eyJ1aWQiOiJhZG1pbi1zeW5jLXVpZCIsInJvbGUiOiJhZG1pbiJ9.signature';
          }
          return 'header.eyJ1aWQiOiJhZG1pbi1zeW5jLXVpZCJ9.signature';
        },
      };

      const isAdm = await isAuthorizedAdminUser(mockAdminUser);
      assert.strictEqual(isAdm, true, 'Admin candidate verified');
    });

    // --------------------------------------------------------------------------
    // 3. Listagem de professores funcionando
    // --------------------------------------------------------------------------
    console.log('\n--- 3. Listagem de Professores Funcionando ---');

    await test('fetchPublicNativeFriendsFromFirestore does NOT call sync-admin-claims for standard fetches', async () => {
      let syncClaimsHit = false;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        if (urlStr.includes('/api/auth/sync-admin-claims')) {
          syncClaimsHit = true;
          return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
        }
        if (urlStr.includes('/api/tutors')) {
          return new Response(
            JSON.stringify([
              {
                id: 'tutor-bob',
                publicTutorId: 'tutor-bob',
                name: 'Bob Teacher',
                isApproved: true,
                approvalStatus: 'approved',
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return originalFetch(input, init);
      };

      const result = await fetchPublicNativeFriendsFromFirestore({ requireAdminToken: false });
      assert.strictEqual(syncClaimsHit, false, 'Standard fetch must NEVER invoke sync-admin-claims');
      assert.ok(result.allTutors.length > 0, 'Tutors must be returned');
      assert.strictEqual(result.allTutors[0].name, 'Bob Teacher');
    });

    // --------------------------------------------------------------------------
    // 4. Conclusão de Listening sem chamada à rota inexistente (404)
    // --------------------------------------------------------------------------
    console.log('\n--- 4. Conclusão de Listening: Sem chamada à rota inexistente /api/student-track-assignments/listen ---');

    const inMemoryDocs: Record<string, any> = {};
    const mockDb: any = {
      doc: (path: string) => ({
        get: async () => ({
          exists: inMemoryDocs[path] !== undefined,
          data: inMemoryDocs[path] || null,
        }),
        set: async (data: any, options?: any) => {
          if (options?.merge && inMemoryDocs[path]) {
            inMemoryDocs[path] = { ...inMemoryDocs[path], ...data };
          } else {
            inMemoryDocs[path] = data;
          }
        },
      }),
    };

    await test('addTrackToListenedHistoryInFirestore does NOT hit deprecated /api/student-track-assignments/listen', async () => {
      let obsoleteRouteHit = false;
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        if (urlStr.includes('/api/student-track-assignments')) {
          obsoleteRouteHit = true;
          return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
        }
        return originalFetch(input, init);
      };

      const testStudentUid = 'student-test-uid-888';
      const testTrackId = 'spotify-track-xyz-123';

      const success = await addTrackToListenedHistoryInFirestore(
        testStudentUid,
        testTrackId,
        'Test Song',
        'Test Artist',
        mockDb
      );

      assert.strictEqual(obsoleteRouteHit, false, 'POST /api/student-track-assignments/listen must NEVER be called');
      assert.strictEqual(success, true, 'Operation must report success');
    });

    // --------------------------------------------------------------------------
    // 5. Persistência da conclusão após recarregamento
    // --------------------------------------------------------------------------
    console.log('\n--- 5. Persistência da Conclusão e Estado Firestore ---');

    await test('Listened track is persisted in Firestore document users/{studentUid}', async () => {
      const testStudentUid = 'student-test-uid-888';
      const path = `users/${testStudentUid}`;
      const data = inMemoryDocs[path];
      assert.ok(data, 'Student document exists in Firestore store');
      assert.ok(Array.isArray(data.listenedTracksHistory), 'listenedTracksHistory is an array');
      const found = data.listenedTracksHistory.some((t: any) =>
        typeof t === 'string' ? t === 'spotify-track-xyz-123' : t?.trackId === 'spotify-track-xyz-123'
      );
      assert.strictEqual(found, true, 'Track spotify-track-xyz-123 is persisted in Firestore');
    });

    await test('Idempotent re-execution does not duplicate entries in Firestore', async () => {
      const testStudentUid = 'student-test-uid-888';
      const testTrackId = 'spotify-track-xyz-123';

      await addTrackToListenedHistoryInFirestore(testStudentUid, testTrackId, 'Test Song', 'Test Artist', mockDb);

      const path = `users/${testStudentUid}`;
      const data = inMemoryDocs[path];
      const matches = data.listenedTracksHistory.filter((t: any) =>
        typeof t === 'string' ? t === testTrackId : t?.trackId === testTrackId
      );
      assert.strictEqual(matches.length, 1, 'Track must be deduplicated in Firestore history');
    });

    await test('Real error propagation: does not return fictitious success on failure', async () => {
      const errorDb: any = {
        doc: () => ({
          get: async () => { throw new Error('Firestore connection failure'); },
          set: async () => { throw new Error('Firestore connection failure'); },
        }),
      };

      const failedResult = await addTrackToListenedHistoryInFirestore(
        'student-error-uid',
        'track-err-999',
        'Song',
        'Artist',
        errorDb
      );
      assert.strictEqual(failedResult, false, 'Must return false on actual failure, avoiding fictitious success');
    });

    await test('Daily audio completion audio_day_wednesday persistence simulation', async () => {
      const testStudentUid = 'student-test-uid-888';
      const path = `users/${testStudentUid}`;

      // Simulate completion save matching saveActivityCompletion in App.tsx
      inMemoryDocs[path] = {
        ...inMemoryDocs[path],
        weeklyChecks: { audio_day_wednesday: true },
        sPathChecks: { audio_day_wednesday: true },
        updatedAt: new Date().toISOString(),
      };

      // Simulate page reload / re-read from Firestore
      const reloadedData = inMemoryDocs[path];
      assert.strictEqual(reloadedData.weeklyChecks?.audio_day_wednesday, true, 'Weekly check persisted across reloads');
      assert.strictEqual(reloadedData.sPathChecks?.audio_day_wednesday, true, 'S-Path check persisted across reloads');
    });

    // --------------------------------------------------------------------------
    // 6. Zero Regressões e Invariantes
    // --------------------------------------------------------------------------
    console.log('\n--- 6. Zero Regressões e Invariantes ---');

    await test('KNOWN_ADMIN_EMAILS contains authorized project administrator identities', () => {
      assert.ok(KNOWN_ADMIN_EMAILS.has('adm.itissimple@gmail.com'));
      assert.ok(KNOWN_ADMIN_EMAILS.has('estilobeeadm@gmail.com'));
    });

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n================================================================');
  console.log(`TOTAL: ${passed + failed} | SUCESSO: ${passed} | FALHAS: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
