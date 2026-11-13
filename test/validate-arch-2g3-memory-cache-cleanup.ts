/**
 * ARCH.2G.3 — Limpeza de Memória e Caches Legados
 *
 * Bateria de testes direcionados cobrindo:
 * 1. Reinício limpo do backend (`initCloudPersistence()`):
 *    - Descarta resíduos anteriores em `inMemoryDb`, mapas globais e caches de servidor.
 *    - Não ressuscita perfis, professores, alunos ou vínculos excluídos a partir de `app_state/*`.
 *    - Zero escritas automáticas em Firestore durante a inicialização (`writeLog.length === 0`).
 * 2. Blindagem de `fetchAppStateFromFirestore` e `saveAppStateToFirestore`:
 *    - `fetchAppStateFromFirestore` não sobrepõe campos legados de `app_state/main_data` sobre `/users`,
 *      não ressuscita tutores de `app_state/tutors` e não inventa saldo `5` para alunos com saldo `0`/indefinido.
 *    - `saveAppStateToFirestore` nunca ressuscita tutores antigos de `app_state/tutors`, nunca escreve em `/tutors/*`
 *      ou `/users/*`, e grava apenas metadados estruturais em `app_state/main_data`.
 * 3. Isolamento entre usuários no cache `aiMemorizationCache` (`POST /api/homework/generate-ai`):
 *    - Aluno B com as mesmas palavras/nível que Aluno A jamais recebe `studentUid`, `studentEmail` ou `studentName` do Aluno A.
 * 4. Invalidação de `localInsightsMap` e controle de acesso de professores:
 *    - `fetchLessonInsightsFromFirestoreServer` remove cache local quando o documento canônico não existe no Firestore.
 *    - `resolveCanonicalStudentIdentity` e `verifyTeacherLessonAccessServer` rejeitam professores não vinculados mesmo que presentes em `tutorsList`.
 * 5. Endpoints de leitura estritamente read-only e filtrados:
 *    - `GET /api/user-profile` não realiza escritas (`writeLog.length === 0`), respeita `deletedStudentEmails`,
 *      prioriza `/users/{uid}` sobre RAM e usa fallback `0` (nunca `5`) para `contractedLessons`.
 *    - `GET /api/meet-settings` não muta `db.meetSettings` e filtra tutores excluídos.
 * 6. Limpeza segura de caches de sessão no navegador (`clearAllClientSessionCaches` & `spotify.ts`):
 *    - `getStoredStudentSpotifyLevel` / `setStoredStudentSpotifyLevel` isolados por aluno em memória, sem `localStorage` compartilhado (`_current`).
 *    - `clearAllClientSessionCaches({ preserveFirebaseAuth: true })` limpa caches em memória e chaves legadas (`its_simple_*`, `currentUserAccount`, `userProfiles*`, etc.) preservando integralmente chaves `firebase:*`.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-mock-gemini-key';

import assert from 'assert';
import http from 'http';
import type { Firestore } from 'firebase-admin/firestore';
import {
  app as serverApp,
  initCloudPersistence,
  readDb,
  resetInMemoryDbForTesting,
  resetResidualCachesForTesting,
} from '../serverApp';
import {
  fetchAppStateFromFirestore,
  saveAppStateToFirestore,
  saveLessonInsightsToFirestoreServer,
  fetchLessonInsightsFromFirestoreServer,
  resolveCanonicalStudentIdentity,
  verifyTeacherLessonAccessServer,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
} from '../src/serverFirestore';
import {
  ALLOWED_STAGING_PROJECT_ID,
  setFirebaseAdminAuthForTesting,
  resetFirebaseAdminForTesting,
} from '../src/serverFirebaseAdmin';
import {
  setGeminiAttemptExecutorForTesting,
  setDistributedCostControlForTesting,
  resetGeminiSecurityStateForTesting,
} from '../src/serverGeminiSecurity';
import {
  getStoredStudentSpotifyLevel,
  setStoredStudentSpotifyLevel,
  setCachedPlaylistTracks,
  getCachedPlaylistTracks,
  SPOTIFY_LEVEL_PLAYLISTS,
} from '../src/utils/spotify';
import {
  cacheVocabularyLocally,
  getCachedLocalVocabulary,
  cacheWeeklyChecksLocally,
  getCachedWeeklyChecks,
  cacheExcludedWordsLocally,
  getCachedExcludedDictionaryWords,
} from '../src/utils/studentPersistence';
import {
  clearAllClientSessionCaches,
  purgeLegacyBrowserStorage,
} from '../src/utils/sessionCacheCleanup';

class MockArch2G3Firestore {
  public projectId = ALLOWED_STAGING_PROJECT_ID;
  public databaseId = '(default)';
  public store = new Map<string, any>();
  public writeLog: Array<{ op: 'set' | 'update' | 'delete'; path: string; data?: any }> = [];

  private getKey(colPath: string, id: string) {
    return `${colPath}::${id}`;
  }

  public collection(colPath: string): any {
    const self = this;
    const makeDocRef = (docId: string): any => ({
      id: docId,
      path: `${colPath}/${docId}`,
      async get() {
        const data = self.store.get(self.getKey(colPath, docId));
        return {
          id: docId,
          exists: data !== undefined,
          data: () => (data !== undefined ? JSON.parse(JSON.stringify(data)) : undefined),
        };
      },
      async set(data: any, options?: { merge?: boolean }) {
        const cloned = JSON.parse(JSON.stringify(data));
        self.writeLog.push({ op: 'set', path: `${colPath}/${docId}`, data: cloned });
        const key = self.getKey(colPath, docId);
        if (options?.merge && self.store.has(key)) {
          const prev = self.store.get(key) || {};
          self.store.set(key, { ...prev, ...cloned });
        } else {
          self.store.set(key, cloned);
        }
        return { writeTime: new Date() };
      },
      async update(data: any) {
        const cloned = JSON.parse(JSON.stringify(data));
        self.writeLog.push({ op: 'update', path: `${colPath}/${docId}`, data: cloned });
        const key = self.getKey(colPath, docId);
        const prev = self.store.get(key) || {};
        self.store.set(key, { ...prev, ...cloned });
        return { writeTime: new Date() };
      },
      async delete() {
        self.writeLog.push({ op: 'delete', path: `${colPath}/${docId}` });
        self.store.delete(self.getKey(colPath, docId));
        return { writeTime: new Date() };
      },
      collection(subColName: string) {
        return self.collection(`${colPath}/${docId}/${subColName}`);
      },
    });

    const querySnapshotFromDocs = (docs: any[]) => ({
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach(cb: (d: any) => void) {
        docs.forEach(cb);
      },
    });

    const buildQuery = (filters: Array<{ field: string; op: string; val: any }> = [], maxLimit?: number): any => ({
      where(field: string, op: string, val: any) {
        return buildQuery([...filters, { field, op, val }], maxLimit);
      },
      orderBy() {
        return buildQuery(filters, maxLimit);
      },
      limit(n: number) {
        return buildQuery(filters, n);
      },
      async get() {
        const prefix = `${colPath}::`;
        const docs: any[] = [];
        for (const [key, data] of self.store.entries()) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          if (rest.includes('/')) continue;
          const matches = filters.every((f) => {
            if (f.op === '==') return data && data[f.field] === f.val;
            if (f.op === 'in' && Array.isArray(f.val)) return data && f.val.includes(data[f.field]);
            return false;
          });
          if (matches) {
            docs.push({
              id: rest,
              exists: true,
              ref: makeDocRef(rest),
              data: () => JSON.parse(JSON.stringify(data)),
            });
          }
          if (maxLimit !== undefined && docs.length >= maxLimit) break;
        }
        return querySnapshotFromDocs(docs);
      },
    });

    return {
      doc: makeDocRef,
      where(field: string, op: string, val: any) {
        return buildQuery([{ field, op, val }]);
      },
      orderBy() {
        return buildQuery([]);
      },
      limit(n: number) {
        return buildQuery([], n);
      },
      async get() {
        return buildQuery().get();
      },
    };
  }
}

function createMockWebStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key: string): string | null {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value));
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    clear(): void {
      map.clear();
    },
    keys(): string[] {
      return Array.from(map.keys());
    },
  };
}

function makeRequest(
  server: http.Server,
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server address unavailable'));
    }
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }
    const req = http.request(
      { host: '127.0.0.1', port: addr.port, path, method, headers: reqHeaders },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 0, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function runArch2G3Tests() {
  console.log('======================================================================');
  console.log("IT'S SIMPLE — ARCH.2G.3 MEMORY & LEGACY CACHE CLEANUP TEST SUITE");
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err?.stack || err?.message || err}`);
    }
  }

  const server = http.createServer(serverApp);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const STUDENT_A_UID = 'StudentCanonUidAlpha12345678';
  const STUDENT_A_EMAIL = 'alpha.student@itissimple.com';
  const STUDENT_B_UID = 'StudentCanonUidBravo12345678';
  const STUDENT_B_EMAIL = 'bravo.student@itissimple.com';
  const TEACHER_LINKED_UID = 'TeacherLinkedUid123456789012';
  const TEACHER_LINKED_EMAIL = 'linked.teacher@itissimple.com';
  const TEACHER_UNLINKED_UID = 'TeacherUnlinkedUid1234567890';
  const TEACHER_UNLINKED_EMAIL = 'unlinked.teacher@itissimple.com';
  const DELETED_STUDENT_UID = 'DeletedStudentUid12345678901';
  const DELETED_STUDENT_EMAIL = 'deleted.student@itissimple.com';
  const DELETED_TUTOR_UID = 'DeletedTutorUid1234567890123';
  const DELETED_TUTOR_EMAIL = 'deleted.tutor@itissimple.com';

  try {
    // ------------------------------------------------------------------------
    // 1. Reinício limpo do backend sem ressurreição de perfis/vínculos e zero escrita no startup
    // ------------------------------------------------------------------------
    await test('1. initCloudPersistence inicia com memória limpa, descarta resíduos de inMemoryDb/app_state/* e não grava no Firestore no boot', async () => {
      const mockDb = new MockArch2G3Firestore();

      // Apenas contas canônicas ativas existem em /users e /tutors
      mockDb.store.set(`users::${STUDENT_A_UID}`, {
        id: STUDENT_A_UID,
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Canonical Alpha',
        role: 'student',
        level: 'intermediate',
        teacherUid: TEACHER_LINKED_UID,
        teacherEmail: TEACHER_LINKED_EMAIL,
      });

      mockDb.store.set(`users::${TEACHER_LINKED_UID}`, {
        id: TEACHER_LINKED_UID,
        uid: TEACHER_LINKED_UID,
        authUid: TEACHER_LINKED_UID,
        email: TEACHER_LINKED_EMAIL,
        name: 'Linked Native Friend',
        role: 'teacher',
        approvalStatus: 'approved',
        status: 'approved',
        isApproved: true,
        approved: true,
      });

      mockDb.store.set(`tutors::${TEACHER_LINKED_UID}`, {
        id: TEACHER_LINKED_UID,
        uid: TEACHER_LINKED_UID,
        authUid: TEACHER_LINKED_UID,
        email: TEACHER_LINKED_EMAIL,
        name: 'Linked Native Friend',
        role: 'teacher',
        approvalStatus: 'approved',
        status: 'approved',
        isApproved: true,
        approved: true,
      });

      // Poluir app_state/* com perfis, vínculos, créditos antigos e tutores excluídos
      mockDb.store.set('app_state::main_data', {
        authUsers: {
          [DELETED_STUDENT_EMAIL]: { uid: DELETED_STUDENT_UID, email: DELETED_STUDENT_EMAIL, name: 'Ghost Student', role: 'student' },
        },
        userProfiles: {
          [DELETED_STUDENT_EMAIL]: {
            id: DELETED_STUDENT_UID,
            uid: DELETED_STUDENT_UID,
            email: DELETED_STUDENT_EMAIL,
            name: 'Ghost Student',
            teacherEmail: DELETED_TUTOR_EMAIL,
            contractedLessons: 12,
          },
          [STUDENT_A_EMAIL]: {
            id: STUDENT_A_UID,
            uid: STUDENT_A_UID,
            email: STUDENT_A_EMAIL,
            name: 'Stale Overwritten Name',
            teacherEmail: DELETED_TUTOR_EMAIL,
            teacherUid: DELETED_TUTOR_UID,
            contractedLessons: 99,
          },
        },
        students: [
          { id: DELETED_STUDENT_UID, email: DELETED_STUDENT_EMAIL, name: 'Ghost Student' },
        ],
        deletedStudentEmails: [DELETED_STUDENT_EMAIL],
        meetSettings: { [DELETED_TUTOR_EMAIL]: { meetLink: 'https://meet.google.com/old-ghost' } },
        chatMessages: [{ id: 'ghost-msg-1', text: 'stale' }],
      });

      mockDb.store.set('app_state::tutors', {
        tutorsList: [
          { id: DELETED_TUTOR_UID, uid: DELETED_TUTOR_UID, email: DELETED_TUTOR_EMAIL, name: 'Deleted Ghost Tutor', approvalStatus: 'approved', isApproved: true },
        ],
        teachers: [
          { id: DELETED_TUTOR_UID, uid: DELETED_TUTOR_UID, email: DELETED_TUTOR_EMAIL, name: 'Deleted Ghost Tutor', role: 'teacher', approvalStatus: 'approved', isApproved: true },
        ],
      });

      mockDb.store.set('app_state::routines', {
        studentRoutinesMap: {
          [DELETED_STUDENT_EMAIL]: { monday: [{ id: 'm1', activityName: 'Ghost Routine' }] },
          [STUDENT_A_EMAIL]: { monday: [{ id: 'm1', activityName: 'Legit Routine' }] },
        },
        studentWeeklyChecks: {
          [DELETED_STUDENT_EMAIL]: { monday_video: true },
        },
      });

      mockDb.store.set('app_state::assignments', {
        studentVideoAssignments: {
          [DELETED_STUDENT_EMAIL]: [{ id: 'v-ghost' }],
          [STUDENT_A_EMAIL]: [{ id: 'v-legit' }],
        },
        studentSpotifyAssignments: {
          [DELETED_STUDENT_EMAIL]: [{ id: 'sp-ghost' }],
        },
      });

      mockDb.store.set('app_state::lessons', {
        contractedLessons: {
          [DELETED_STUDENT_EMAIL]: 15,
        },
      });

      // Poluir também inMemoryDb ANTES do restart para simular memória suja pré-existente
      const dirtyDb = readDb();
      dirtyDb.tutorsList.push({ id: 'pre-restart-tutor', email: 'prerestart@itissimple.com', name: 'PreRestart Tutor' });
      dirtyDb.teachers.push({ email: 'prerestart@itissimple.com', name: 'PreRestart Tutor', role: 'teacher' });
      dirtyDb.userProfiles['prerestart.student@itissimple.com'] = { email: 'prerestart.student@itissimple.com', name: 'PreRestart Student' };
      dirtyDb.studentVideoAssignments['prerestart.student@itissimple.com'] = [{ id: 'v-pre' }];
      dirtyDb.chatMessages.push({ id: 'msg-pre', text: 'dirty' });

      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);
      mockDb.writeLog = [];

      await initCloudPersistence();

      // Zero escritas no Firestore durante inicialização!
      assert.strictEqual(mockDb.writeLog.length, 0, `Startup não deve gravar no Firestore, mas gravou: ${JSON.stringify(mockDb.writeLog)}`);

      const hydrated = readDb();

      // Nenhuma conta pré-restart sobrevive
      assert(!hydrated.userProfiles['prerestart.student@itissimple.com'], 'Resíduo pré-restart em userProfiles foi descartado');
      assert(!hydrated.studentVideoAssignments['prerestart.student@itissimple.com'], 'Resíduo pré-restart em studentVideoAssignments foi descartado');
      assert(!(hydrated.tutorsList || []).some((t: any) => t.email === 'prerestart@itissimple.com'), 'Tutor pré-restart foi descartado');
      assert.strictEqual((hydrated.chatMessages || []).length, 0, 'chatMessages legado limpo na inicialização');

      // Nenhum perfil/tutor/vínculo excluído de app_state/* ressuscita
      assert(!hydrated.authUsers[DELETED_STUDENT_EMAIL], 'Aluno excluído não ressuscitou em authUsers');
      assert(!hydrated.userProfiles[DELETED_STUDENT_EMAIL], 'Aluno excluído não ressuscitou em userProfiles');
      assert(!(hydrated.students || []).some((s: any) => (s.email || s.studentEmail) === DELETED_STUDENT_EMAIL), 'Aluno excluído não ressuscitou em students');
      assert(!(hydrated.tutorsList || []).some((t: any) => t.email === DELETED_TUTOR_EMAIL), 'Tutor excluído em app_state/tutors não ressuscitou em tutorsList');
      assert(!(hydrated.teachers || []).some((t: any) => t.email === DELETED_TUTOR_EMAIL), 'Tutor excluído em app_state/tutors não ressuscitou em teachers');
      assert(!hydrated.studentRoutinesMap[DELETED_STUDENT_EMAIL], 'Rotina órfã filtrada');
      assert(!hydrated.studentVideoAssignments[DELETED_STUDENT_EMAIL], 'Vídeo órfão filtrado');
      assert(!hydrated.studentSpotifyAssignments[DELETED_STUDENT_EMAIL], 'Spotify órfão filtrado');
      assert.strictEqual(hydrated.contractedLessons[DELETED_STUDENT_EMAIL], undefined, 'Créditos órfãos filtrados');

      // Conta canônica preserva autoridade de /users (sem ser sobrescrita por app_state/main_data e sem inventar saldo 5)
      const alphaProfile = hydrated.userProfiles[STUDENT_A_EMAIL];
      assert(alphaProfile, 'Aluno canônico hidratado em userProfiles');
      assert.strictEqual(alphaProfile.name, 'Canonical Alpha', 'Nome canônico de /users preservado sem overlay de app_state/main_data');
      assert.strictEqual(alphaProfile.teacherUid, TEACHER_LINKED_UID, 'Vínculo canônico teacherUid preservado sem overlay de tutor excluído');
      assert.strictEqual(alphaProfile.teacherEmail, TEACHER_LINKED_EMAIL, 'Vínculo canônico teacherEmail preservado');
      assert.strictEqual(alphaProfile.contractedLessons ?? 0, 0, 'Saldo em userProfiles não herda 99 de app_state/main_data nem inventa 5');
      const alphaStudentEntry = (hydrated.students || []).find((s: any) => s.email === STUDENT_A_EMAIL);
      assert(alphaStudentEntry, 'Aluno canônico hidratado em students');
      assert.strictEqual(alphaStudentEntry.contractedLessons, 0, 'Saldo não definido em /users deve iniciar em 0 em students (jamais 5 ou 99)');
      assert(Boolean(hydrated.studentRoutinesMap[STUDENT_A_EMAIL]), 'Rotina legítima preservada');
      assert(Boolean(hydrated.studentVideoAssignments[STUDENT_A_EMAIL]), 'Atribuição legítima preservada');
    });

    // ------------------------------------------------------------------------
    // 2. saveAppStateToFirestore nunca ressuscita tutores nem grava em /users ou /tutors
    // ------------------------------------------------------------------------
    await test('2. saveAppStateToFirestore não ressuscita app_state/tutors quando lista está vazia e nunca escreve em /tutors/* ou /users/*', async () => {
      const mockDb = new MockArch2G3Firestore();
      mockDb.store.set('app_state::tutors', {
        tutorsList: [{ id: DELETED_TUTOR_UID, email: DELETED_TUTOR_EMAIL, name: 'Ghost Tutor' }],
        teachers: [{ id: DELETED_TUTOR_UID, email: DELETED_TUTOR_EMAIL, name: 'Ghost Tutor', role: 'teacher' }],
      });

      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);
      mockDb.writeLog = [];

      await saveAppStateToFirestore({
        tutorsList: [],
        teachers: [],
        authUsers: { [STUDENT_A_EMAIL]: { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, name: 'Alpha', role: 'student' } },
        userProfiles: { [STUDENT_A_EMAIL]: { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, name: 'Alpha' } },
        students: [{ id: STUDENT_A_UID, email: STUDENT_A_EMAIL, name: 'Alpha' }],
        landingContent: { heroBadge: 'Clean Badge' },
        spotifyPlaylists: {},
        deletedStudentEmails: [DELETED_STUDENT_EMAIL],
      });

      // Nenhuma escrita em /users/* ou /tutors/*
      const canonicalWrites = mockDb.writeLog.filter(
        (w) => w.path.startsWith('users/') || w.path.startsWith('tutors/')
      );
      assert.strictEqual(canonicalWrites.length, 0, `saveAppStateToFirestore não deve gravar em /users ou /tutors: ${JSON.stringify(canonicalWrites)}`);

      // app_state/tutors deve estar limpo (sem ressuscitar Ghost Tutor)
      const savedTutorsState = mockDb.store.get('app_state::tutors');
      assert.strictEqual((savedTutorsState?.tutorsList || []).length, 0, 'tutorsList salvo vazio sem ressuscitar tutor antigo');
      assert.strictEqual((savedTutorsState?.teachers || []).length, 0, 'teachers salvo vazio sem ressuscitar tutor antigo');

      // app_state/main_data deve conter apenas chaves estruturais (sem authUsers, userProfiles, students)
      const savedMainData = mockDb.store.get('app_state::main_data');
      assert.strictEqual(savedMainData.authUsers, undefined, 'main_data não persiste authUsers');
      assert.strictEqual(savedMainData.userProfiles, undefined, 'main_data não persiste userProfiles');
      assert.strictEqual(savedMainData.students, undefined, 'main_data não persiste students');
      assert.strictEqual(savedMainData.landingContent?.heroBadge, 'Clean Badge', 'main_data preserva landingContent estrutural');
    });

    // ------------------------------------------------------------------------
    // 3. Isolamento por usuário em POST /api/homework/generate-ai (aiMemorizationCache)
    // ------------------------------------------------------------------------
    await test('3. POST /api/homework/generate-ai isola cache de resposta por aluno (sem vazar studentUid/studentEmail/studentName entre contas)', async () => {
      resetInMemoryDbForTesting();
      resetGeminiSecurityStateForTesting();
      setDistributedCostControlForTesting(false);

      const mockDb = new MockArch2G3Firestore();
      mockDb.store.set(`users::${STUDENT_A_UID}`, {
        id: STUDENT_A_UID,
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Alice Alpha',
        role: 'student',
        level: 'Intermediate',
      });
      mockDb.store.set(`users::${STUDENT_B_UID}`, {
        id: STUDENT_B_UID,
        uid: STUDENT_B_UID,
        email: STUDENT_B_EMAIL,
        name: 'Bruno Bravo',
        role: 'student',
        level: 'Intermediate',
      });
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);

      setFirebaseAdminAuthForTesting({
        verifyIdToken: async (token: string) => {
          if (token === 'token-student-a') {
            return { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' };
          }
          if (token === 'token-student-b') {
            return { uid: STUDENT_B_UID, email: STUDENT_B_EMAIL, email_verified: true, role: 'student' };
          }
          throw new Error('Invalid token');
        },
      } as any);

      const targetWords = ['resilient', 'deadline', 'negotiate'];
      const validStory = [
        'Clara arrived at the regional studio early on Tuesday morning because her **resilient** engineering crew needed a clear plan before the client presentation.',
        'When the supplier delayed the hardware shipment, she decided to **negotiate** revised delivery terms directly with the logistics coordinator over a video call.',
        'Everyone collaborated calmly across departments so the revised prototype would still meet Friday afternoon’s strict **deadline** without sacrificing product reliability.',
        'By evening, the client approved the updated roadmap and praised how transparent communication turned an unexpected obstacle into a stronger partnership.',
      ].join('\n\n');

      setGeminiAttemptExecutorForTesting(async () => ({
        text: 'ok',
        parsedJson: {
          matchingPairs: [
            { id: 'm1', word: 'resilient', definition: 'Able to recover quickly after setbacks at work', translation: 'resiliente' },
            { id: 'm2', word: 'deadline', definition: 'Final date or time by which a task must be submitted', translation: 'prazo final' },
            { id: 'm3', word: 'negotiate', definition: 'Discuss terms formally to reach a mutual agreement', translation: 'negociar' },
          ],
          fillInBlanks: [
            {
              id: 'f1',
              sentenceWithBlank: 'Her ______ mindset helped the product team adapt after the sudden budget cut.',
              correctWord: 'resilient',
              options: ['resilient', 'fragile', 'hesitant', 'careless'],
              hintPt: 'Capaz de se adaptar a imprevistos',
              hintEn: 'Able to recover from difficulties',
              explanationPt: 'Resilient descreve quem supera dificuldades.',
              explanationEn: 'Resilient fits adapting after a budget cut.',
            },
            {
              id: 'f2',
              sentenceWithBlank: 'We submitted the quarterly financial report two hours before the official ______.',
              correctWord: 'deadline',
              options: ['deadline', 'luggage', 'corridor', 'receipt'],
              hintPt: 'Data limite de entrega',
              hintEn: 'Final submission time',
              explanationPt: 'Deadline significa prazo final.',
              explanationEn: 'Deadline refers to the final due time.',
            },
            {
              id: 'f3',
              sentenceWithBlank: 'Our manager flew to Chicago to ______ a fairer licensing contract with the vendor.',
              correctWord: 'negotiate',
              options: ['negotiate', 'whisper', 'postpone', 'scatter'],
              hintPt: 'Conversar para chegar a um acordo',
              hintEn: 'Discuss to reach a deal',
              explanationPt: 'Negotiate significa negociar um contrato.',
              explanationEn: 'Negotiate matches reaching a licensing deal.',
            },
          ],
          sentenceWritingPrompts: [
            { word: 'resilient', hint: 'Write about staying resilient during a busy week.', hintPt: 'Escreva sobre ser resiliente.', hintEn: 'Stay resilient.', levelInstruction: 'Use a connector like because or although.' },
            { word: 'deadline', hint: 'Write about meeting an important deadline.', hintPt: 'Escreva sobre cumprir um prazo.', hintEn: 'Meet a deadline.', levelInstruction: 'Use past or present perfect.' },
            { word: 'negotiate', hint: 'Write about when you had to negotiate a schedule.', hintPt: 'Escreva sobre negociar um horário.', hintEn: 'Negotiate a schedule.', levelInstruction: 'Use a modal verb.' },
          ],
          readingPassage: {
            title: 'Turning Pressure into Partnership',
            text: validStory,
            questions: [
              {
                id: 'q-1',
                question: 'Why did Clara contact the logistics coordinator on Tuesday?',
                options: [
                  'To negotiate revised delivery terms after a shipment delay',
                  'To cancel the client partnership permanently',
                  'To rent a new office building downtown',
                  'To hire four additional graphic designers',
                ],
                correctAnswer: 0,
                explanation: 'She negotiated revised delivery terms when the hardware shipment was delayed.',
              },
              {
                id: 'q-2',
                question: 'How did the client react by the end of the day?',
                options: [
                  'They approved the updated roadmap and praised the transparent communication',
                  'They postponed the launch until next year',
                  'They requested a full refund immediately',
                  'They replaced the engineering crew',
                ],
                correctAnswer: 0,
                explanation: 'The final paragraph states the client approved the roadmap.',
              },
            ],
          },
        },
      }));

      const resA = await makeRequest(
        server,
        'POST',
        '/api/homework/generate-ai',
        { words: targetWords, studentLevel: 'Intermediate', studentName: 'Alice Alpha' },
        { Authorization: 'Bearer token-student-a' }
      );
      assert.strictEqual(resA.status, 200, `Esperado 200 para Student A, obtido ${resA.status}: ${JSON.stringify(resA.data)}`);
      assert.strictEqual(resA.data?.homework?.studentUid, STUDENT_A_UID);
      assert.strictEqual(resA.data?.homework?.studentEmail, STUDENT_A_EMAIL);

      const resB = await makeRequest(
        server,
        'POST',
        '/api/homework/generate-ai',
        { words: targetWords, studentLevel: 'Intermediate', studentName: 'Bruno Bravo' },
        { Authorization: 'Bearer token-student-b' }
      );
      assert.strictEqual(resB.status, 200, `Esperado 200 para Student B, obtido ${resB.status}`);
      assert.strictEqual(resB.data?.homework?.studentUid, STUDENT_B_UID, 'Student B jamais deve receber studentUid de Student A');
      assert.strictEqual(resB.data?.homework?.studentEmail, STUDENT_B_EMAIL, 'Student B jamais deve receber studentEmail de Student A');
      assert.strictEqual(resB.data?.homework?.studentName, 'Bruno Bravo', 'Student B jamais deve receber studentName de Student A');
      assert.strictEqual(resB.data?.homework?.id, `hw-ai-${STUDENT_B_UID}`, 'ID do homework deve pertencer ao Student B');
    });

    // ------------------------------------------------------------------------
    // 4. Evicção de localInsightsMap e bloqueio de tutores não vinculados
    // ------------------------------------------------------------------------
    await test('4. fetchLessonInsightsFromFirestoreServer invalida cache local quando ausente no Firestore e acesso de professor exige vínculo real', async () => {
      resetResidualCachesForTesting();
      const mockDb = new MockArch2G3Firestore();

      mockDb.store.set(`users::${STUDENT_A_UID}`, {
        id: STUDENT_A_UID,
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Canonical Alpha',
        role: 'student',
        teacherUid: TEACHER_LINKED_UID,
        teacherEmail: TEACHER_LINKED_EMAIL,
      });
      mockDb.store.set(`tutors::${TEACHER_UNLINKED_UID}`, {
        id: TEACHER_UNLINKED_UID,
        uid: TEACHER_UNLINKED_UID,
        authUid: TEACHER_UNLINKED_UID,
        email: TEACHER_UNLINKED_EMAIL,
        name: 'Unlinked Tutor',
        role: 'teacher',
        approvalStatus: 'approved',
        status: 'approved',
        isApproved: true,
        approved: true,
      });

      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);
      await initCloudPersistence();

      // Salva insights de aula e depois deleta diretamente do Firestore canônico
      await saveLessonInsightsToFirestoreServer('lesson-test-evict-1', { summary: 'Temporary insight' });
      const fetchedBeforeDelete = await fetchLessonInsightsFromFirestoreServer('lesson-test-evict-1');
      assert.strictEqual(fetchedBeforeDelete?.summary, 'Temporary insight', 'Insight retornado enquanto existe no Firestore');

      mockDb.store.delete('lesson_insights::lesson-test-evict-1');
      const fetchedAfterDelete = await fetchLessonInsightsFromFirestoreServer('lesson-test-evict-1');
      assert.strictEqual(fetchedAfterDelete, null, 'localInsightsMap não deve ressuscitar insight deletado do Firestore');

      // Mesmo que tutor não vinculado esteja aprovado em tutorsList, ele NÃO pode acessar aluno sem vínculo
      const unlinkedIdentityCheck = await resolveCanonicalStudentIdentity({
        caller: { uid: TEACHER_UNLINKED_UID, email: TEACHER_UNLINKED_EMAIL, role: 'teacher' } as any,
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
      });
      assert.strictEqual(unlinkedIdentityCheck.authorized, false, 'Tutor não vinculado deve ser bloqueado em resolveCanonicalStudentIdentity');

      const unlinkedLessonCheck = await verifyTeacherLessonAccessServer(
        TEACHER_UNLINKED_UID,
        TEACHER_UNLINKED_EMAIL,
        STUDENT_A_UID,
        'non-existent-lesson',
        'teacher',
        STUDENT_A_EMAIL
      );
      assert.strictEqual(unlinkedLessonCheck, false, 'Tutor não vinculado deve ser bloqueado em verifyTeacherLessonAccessServer');

      // Tutor vinculado continua autorizado normalmente
      const linkedIdentityCheck = await resolveCanonicalStudentIdentity({
        caller: { uid: TEACHER_LINKED_UID, email: TEACHER_LINKED_EMAIL, role: 'teacher' } as any,
        studentUid: STUDENT_A_UID,
        studentEmail: STUDENT_A_EMAIL,
      });
      assert.strictEqual(linkedIdentityCheck.authorized, true, 'Tutor canonicamente vinculado continua autorizado');
    });

    // ------------------------------------------------------------------------
    // 5. GET /api/user-profile e GET /api/meet-settings estritamente read-only e sem resíduos
    // ------------------------------------------------------------------------
    await test('5. GET /api/user-profile e GET /api/meet-settings são estritamente read-only, filtram excluídos e não inventam créditos', async () => {
      const mockDb = new MockArch2G3Firestore();
      mockDb.store.set(`users::${STUDENT_A_UID}`, {
        id: STUDENT_A_UID,
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Canonical Alpha',
        role: 'student',
        level: 'advanced',
      });
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);
      await initCloudPersistence();

      const db = readDb();
      // Poluir RAM com nome/nível antigos e tutor deletado em meetSettings
      db.userProfiles[STUDENT_A_EMAIL] = {
        id: STUDENT_A_UID,
        uid: STUDENT_A_UID,
        email: STUDENT_A_EMAIL,
        name: 'Stale RAM Name',
        level: 'beginner',
      };
      db.deletedStudentEmails = [DELETED_STUDENT_EMAIL];
      db.deletedTutorEmails = [DELETED_TUTOR_EMAIL];
      db.meetSettings[DELETED_TUTOR_EMAIL] = {
        teacherEmail: DELETED_TUTOR_EMAIL,
        meetLink: 'https://meet.google.com/deleted-tutor',
      };

      setFirebaseAdminAuthForTesting({
        verifyIdToken: async (token: string) => {
          if (token === 'token-student-a') {
            return { uid: STUDENT_A_UID, email: STUDENT_A_EMAIL, email_verified: true, role: 'student' };
          }
          if (token === 'token-deleted-student') {
            return { uid: DELETED_STUDENT_UID, email: DELETED_STUDENT_EMAIL, email_verified: true, role: 'student' };
          }
          throw new Error('Invalid token');
        },
      } as any);

      mockDb.writeLog = [];

      const profileRes = await makeRequest(
        server,
        'GET',
        `/api/user-profile?email=${encodeURIComponent(STUDENT_A_EMAIL)}&uid=${encodeURIComponent(STUDENT_A_UID)}`,
        undefined,
        { Authorization: 'Bearer token-student-a' }
      );
      assert.strictEqual(profileRes.status, 200);
      assert.strictEqual(profileRes.data?.profile?.name, 'Canonical Alpha', 'GET /api/user-profile prioriza Firestore /users sobre RAM');
      assert.strictEqual(profileRes.data?.profile?.level, 'advanced', 'GET /api/user-profile prioriza nível canônico de /users sobre RAM');
      assert.strictEqual(profileRes.data?.profile?.contractedLessons, 0, 'GET /api/user-profile usa fallback 0 em vez de 5');
      assert.strictEqual(mockDb.writeLog.length, 0, 'GET /api/user-profile não deve gerar escritas no Firestore');

      const deletedProfileRes = await makeRequest(
        server,
        'GET',
        `/api/user-profile?email=${encodeURIComponent(DELETED_STUDENT_EMAIL)}&uid=${encodeURIComponent(DELETED_STUDENT_UID)}`,
        undefined,
        { Authorization: 'Bearer token-deleted-student' }
      );
      assert.strictEqual(deletedProfileRes.status, 200);
      assert.strictEqual(deletedProfileRes.data?.profile, null, 'GET /api/user-profile retorna profile=null para aluno listado em deletedStudentEmails');
      assert.strictEqual(mockDb.writeLog.length, 0, 'GET /api/user-profile para excluído não grava nada');

      const meetSettingsBeforeKeys = Object.keys(db.meetSettings);
      const meetRes = await makeRequest(
        server,
        'GET',
        `/api/meet-settings?teacherEmail=${encodeURIComponent('new.unconfigured.tutor@itissimple.com')}`
      );
      assert.strictEqual(meetRes.status, 200);
      assert.strictEqual(meetRes.data?.settings?.[DELETED_TUTOR_EMAIL], undefined, 'GET /api/meet-settings filtra tutor excluído');
      assert.deepStrictEqual(Object.keys(db.meetSettings), meetSettingsBeforeKeys, 'GET /api/meet-settings não muta db.meetSettings em leitura');
    });

    // ------------------------------------------------------------------------
    // 6. Caches do navegador: isolamento Spotify por aluno e preservação de firebase:* no logout/troca de conta
    // ------------------------------------------------------------------------
    await test('6. clearAllClientSessionCaches e spotify.ts limpam caches/resíduos legados do navegador preservando chaves firebase:*', async () => {
      const mockLocalStorage = createMockWebStorage();
      const mockSessionStorage = createMockWebStorage();
      const prevWindow = (globalThis as any).window;
      const prevLocalStorage = (globalThis as any).localStorage;
      const prevSessionStorage = (globalThis as any).sessionStorage;

      try {
        (globalThis as any).window = {
          localStorage: mockLocalStorage,
          sessionStorage: mockSessionStorage,
        };
        (globalThis as any).localStorage = mockLocalStorage;
        (globalThis as any).sessionStorage = mockSessionStorage;

        // 6a. Isolamento de nível Spotify por aluno em memória (sem chave global _current)
        setStoredStudentSpotifyLevel(STUDENT_A_UID, 'advanced');
        assert.strictEqual(getStoredStudentSpotifyLevel(STUDENT_A_UID), 'advanced', 'Student A lê seu próprio nível em memória');
        assert.strictEqual(getStoredStudentSpotifyLevel(STUDENT_B_UID), null, 'Student B não herda nível de Student A');
        assert.strictEqual(mockLocalStorage.getItem('its_simple_spotify_level_pref_current'), null, 'Zero escrita de chave compartilhada no localStorage');

        // 6b. Popular caches de memória do cliente e chaves legadas + Firebase Auth no navegador
        cacheVocabularyLocally(STUDENT_A_UID, STUDENT_A_EMAIL, [{ id: 'w1', word: 'thrive' } as any]);
        cacheWeeklyChecksLocally(STUDENT_A_UID, STUDENT_A_EMAIL, { monday_video: true }, 'week-1');
        cacheExcludedWordsLocally(STUDENT_A_UID, STUDENT_A_EMAIL, ['obsolete']);
        setCachedPlaylistTracks('advanced', SPOTIFY_LEVEL_PLAYLISTS.advanced.playlistId, [{ id: 't1' } as any]);
        assert.strictEqual(getCachedLocalVocabulary(STUDENT_A_UID, STUDENT_A_EMAIL).length, 1, 'Pré-condição: vocabulário em cache');
        assert.deepStrictEqual(getCachedWeeklyChecks(STUDENT_A_UID, STUDENT_A_EMAIL, 'week-1'), { monday_video: true }, 'Pré-condição: weeklyChecks em cache');
        assert.strictEqual(getCachedExcludedDictionaryWords(STUDENT_A_UID, STUDENT_A_EMAIL).length, 1, 'Pré-condição: excludedWords em cache');

        mockLocalStorage.setItem('firebase:authUser:AIzaSyFakeKey:[DEFAULT]', '{"uid":"StudentCanonUidAlpha12345678"}');
        mockLocalStorage.setItem('firebaseLocalStorageDb', 'keep-auth-db');
        mockLocalStorage.setItem('app_theme_preference', 'light');
        mockLocalStorage.setItem('currentUserAccount', '{"email":"legacy@itissimple.com"}');
        mockLocalStorage.setItem('userProfiles_legacy', '{}');
        mockLocalStorage.setItem('its_simple_vocabulary_master', '["ghost"]');
        mockLocalStorage.setItem('its_simple_spotify_level_pref_current', 'advanced');
        mockLocalStorage.setItem('studentVocabulary_old', '[]');

        mockSessionStorage.setItem('its_simple_preselected_tutor_id', 'tutor-ghost');
        mockSessionStorage.setItem('google_oauth_token', 'ya29.stale-token');
        mockSessionStorage.setItem('firebase:session:key', 'keep-session-auth');

        // Purge no mount sem limpar sessionStorage de pré-seleção de onboarding
        purgeLegacyBrowserStorage({ preserveFirebaseAuth: true, clearSessionStorage: false });
        assert.strictEqual(mockLocalStorage.getItem('firebase:authUser:AIzaSyFakeKey:[DEFAULT]'), '{"uid":"StudentCanonUidAlpha12345678"}', 'Firebase Auth preservado no boot');
        assert.strictEqual(mockLocalStorage.getItem('currentUserAccount'), null, 'currentUserAccount legado removido no boot');
        assert.strictEqual(mockSessionStorage.getItem('its_simple_preselected_tutor_id'), 'tutor-ghost', 'Pré-seleção de tutor em sessionStorage preservada quando clearSessionStorage=false');

        // Limpeza completa em logout / troca de conta
        clearAllClientSessionCaches({ preserveFirebaseAuth: true });

        assert.strictEqual(getCachedLocalVocabulary(STUDENT_A_UID, STUDENT_A_EMAIL).length, 0, 'Cache de vocabulário limpo no logout');
        assert.deepStrictEqual(getCachedWeeklyChecks(STUDENT_A_UID, STUDENT_A_EMAIL, 'week-1'), {}, 'Cache de weeklyChecks limpo no logout');
        assert.strictEqual(getCachedExcludedDictionaryWords(STUDENT_A_UID, STUDENT_A_EMAIL).length, 0, 'Cache de palavras excluídas limpo no logout');
        assert.strictEqual(getStoredStudentSpotifyLevel(STUDENT_A_UID), null, 'Mapa de nível Spotify limpo no logout');
        assert.strictEqual(getCachedPlaylistTracks('advanced'), null, 'Cache de playlists Spotify limpo no logout');

        // Chaves Firebase Auth e configurações neutras preservadas; chaves legadas removidas
        assert.strictEqual(
          mockLocalStorage.getItem('firebase:authUser:AIzaSyFakeKey:[DEFAULT]'),
          '{"uid":"StudentCanonUidAlpha12345678"}',
          'Chave firebase:authUser preservada intacta'
        );
        assert.strictEqual(mockLocalStorage.getItem('firebaseLocalStorageDb'), 'keep-auth-db', 'Chave firebaseLocalStorageDb preservada');
        assert.strictEqual(mockLocalStorage.getItem('app_theme_preference'), 'light', 'Configuração neutra preservada');
        assert.strictEqual(mockLocalStorage.getItem('userProfiles_legacy'), null, 'userProfiles_legacy removido');
        assert.strictEqual(mockLocalStorage.getItem('its_simple_vocabulary_master'), null, 'its_simple_vocabulary_master removido');
        assert.strictEqual(mockLocalStorage.getItem('its_simple_spotify_level_pref_current'), null, 'its_simple_spotify_level_pref_current removido');
        assert.strictEqual(mockLocalStorage.getItem('studentVocabulary_old'), null, 'studentVocabulary_old removido');

        assert.strictEqual(mockSessionStorage.getItem('its_simple_preselected_tutor_id'), null, 'its_simple_preselected_tutor_id removido no logout');
        assert.strictEqual(mockSessionStorage.getItem('google_oauth_token'), null, 'google_oauth_token removido no logout');
        assert.strictEqual(mockSessionStorage.getItem('firebase:session:key'), 'keep-session-auth', 'firebase:* em sessionStorage preservado');
      } finally {
        if (prevWindow === undefined) delete (globalThis as any).window;
        else (globalThis as any).window = prevWindow;
        if (prevLocalStorage === undefined) delete (globalThis as any).localStorage;
        else (globalThis as any).localStorage = prevLocalStorage;
        if (prevSessionStorage === undefined) delete (globalThis as any).sessionStorage;
        else (globalThis as any).sessionStorage = prevSessionStorage;
      }
    });
  } finally {
    resetGeminiSecurityStateForTesting();
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
    resetInMemoryDbForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n======================================================================');
  console.log(`ARCH.2G.3 SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runArch2G3Tests().catch((err) => {
  console.error('Fatal error in ARCH.2G.3 test suite:', err);
  process.exit(1);
});
