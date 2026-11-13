/**
 * TEST SUITE: HOTFIX ARCH.2F.SEC — Segurança Native Friends Notes & Google Drive
 * Projeto: It's Simple — Security Staging
 *
 * Validações Obrigatórias:
 * 1. 401 em todas as rotas alvo sem token, token inválido, expirado ou malformado.
 * 2. Validação de UID canônico (rejeição de UIDs sintéticos).
 * 3. /api/session-notes/progress (GET/POST): isolamento entre alunos, professor vinculado vs não vinculado/pendente, admin.
 * 4. /api/session-notes/reminder/claim (POST): isolamento entre alunos, bloqueio de professores, idempotência diária.
 * 5. /api/drive/sync-session-notes e /api/drive/files/*: RBAC de professor aprovado vinculado / admin para sync; aluno proprietário / professor vinculado / admin para visualização e download; proteção contra colisão/spoofing.
 * 6. /api/pedagogical-notes (GET): proteção mesmo quando studentUid, sessionKey/lessonId ou ambos estiverem ausentes.
 * 7. Regressão do fluxo completo Apply AI -> Approve & Publish -> Drive Sync -> Progress -> Reminder Claim.
 */

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'itissimple-security-staging';
process.env.FIREBASE_DATABASE_ID = '(default)';

import fs from 'fs';
import path from 'path';
import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { setFirebaseAdminFirestoreForTesting } from '../src/serverFirestore';
import { app, setSessionNoteTransformAttemptExecutorForTesting } from '../serverApp';

// Backup db.json so local state isn't permanently mutated during test run
const DB_PATH = path.join(process.cwd(), 'db.json');
const dbBackup = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH, 'utf-8') : null;

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

class MockDocRef {
  constructor(public id: string, private store: Map<string, any>, private parentPath: string) {}

  async get() {
    const key = `${this.parentPath}/${this.id}`;
    const data = this.store.get(key);
    return {
      id: this.id,
      exists: Boolean(data),
      data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
    };
  }

  async set(data: any, options?: { merge?: boolean }) {
    const key = `${this.parentPath}/${this.id}`;
    const existing = this.store.get(key) || {};
    const merged = options?.merge
      ? { ...existing, ...JSON.parse(JSON.stringify(data)) }
      : JSON.parse(JSON.stringify(data));
    this.store.set(key, merged);
  }

  collection(subName: string) {
    return new MockCollectionRef(`${this.parentPath}/${this.id}/${subName}`, this.store);
  }
}

class MockQueryRef {
  constructor(
    private path: string,
    private store: Map<string, any>,
    private filters: Array<{ field: string; op: string; value: any }> = [],
    private maxLimit?: number
  ) {}

  where(field: string, op: string, value: any) {
    return new MockQueryRef(this.path, this.store, [...this.filters, { field, op, value }], this.maxLimit);
  }

  limit(n: number) {
    return new MockQueryRef(this.path, this.store, this.filters, n);
  }

  async get() {
    const docs: any[] = [];
    const prefix = `${this.path}/`;
    for (const [k, v] of this.store.entries()) {
      if (!k.startsWith(prefix)) continue;
      const remainder = k.substring(prefix.length);
      if (remainder.includes('/')) continue;

      let matches = true;
      for (const f of this.filters) {
        if (f.op === '==' && v?.[f.field] !== f.value) {
          matches = false;
          break;
        }
      }
      if (matches) {
        docs.push({
          id: remainder,
          exists: true,
          data: () => JSON.parse(JSON.stringify(v)),
        });
      }
      if (this.maxLimit && docs.length >= this.maxLimit) break;
    }
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach: (cb: any) => docs.forEach(cb),
    };
  }
}

class MockCollectionRef extends MockQueryRef {
  constructor(private colPath: string, private colStore: Map<string, any>) {
    super(colPath, colStore);
  }

  doc(id: string) {
    return new MockDocRef(id, this.colStore, this.colPath);
  }
}

class MockFirestoreDb {
  public store = new Map<string, any>();

  collection(name: string) {
    return new MockCollectionRef(name, this.store);
  }

  async runTransaction(updateFunction: (tx: any) => Promise<any>) {
    const tx = {
      get: async (ref: MockDocRef) => ref.get(),
      set: async (ref: MockDocRef, data: any, options?: any) => ref.set(data, options),
    };
    return updateFunction(tx);
  }
}

function simulateRequest(
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body: any = null
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

    app(req, res, (err?: any) => {
      if (err) {
        resolve({ status: 500, headers: resHeaders, body: { error: err.message } });
      } else {
        resolve({ status: statusCode === 200 ? 404 : statusCode, headers: resHeaders, body: resBody });
      }
    });
  });
}

// Canonical test actors
const STUDENT_1 = { uid: 'canonicalStudentUid00001', email: 'student1.arch2f@itissimple.test', role: 'student' as const };
const STUDENT_2 = { uid: 'canonicalStudentUid00002', email: 'student2.arch2f@itissimple.test', role: 'student' as const };
const TEACHER_LINKED = { uid: 'canonicalTeacherLinked01', email: 'teacher.linked@itissimple.test', role: 'teacher' as const };
const TEACHER_UNLINKED = { uid: 'canonicalTeacherUnlinked2', email: 'teacher.unlinked@itissimple.test', role: 'teacher' as const };
const TEACHER_PENDING = { uid: 'canonicalTeacherPending03', email: 'teacher.pending@itissimple.test', role: 'teacher' as const };
const ADMIN_1 = { uid: 'canonicalAdminUid0000001', email: 'admin.arch2f@itissimple.test', role: 'admin' as const };
const SYNTHETIC_USER = { uid: 'usr-synthetic-bad-1', email: 'synthetic@itissimple.test', role: 'student' as const };

const tokenMap: Record<string, { uid: string; email: string; role: 'student' | 'teacher' | 'admin' }> = {
  'tok-student-1': STUDENT_1,
  'tok-student-2': STUDENT_2,
  'tok-teacher-linked': TEACHER_LINKED,
  'tok-teacher-unlinked': TEACHER_UNLINKED,
  'tok-teacher-pending': TEACHER_PENDING,
  'tok-admin-1': ADMIN_1,
  'tok-synthetic': SYNTHETIC_USER,
};

const mockFirestore = new MockFirestoreDb();
setFirebaseAdminFirestoreForTesting(mockFirestore as any);

setFirebaseAdminAuthForTesting({
  verifyIdToken: async (token: string) => {
    if (token === 'expired-token') {
      const err: any = new Error('Token expired');
      err.code = 'auth/id-token-expired';
      throw err;
    }
    const u = tokenMap[token];
    if (!u) {
      const err: any = new Error('Invalid token');
      err.code = 'auth/invalid-id-token';
      throw err;
    }
    return {
      uid: u.uid,
      email: u.email,
      email_verified: true,
      role: u.role,
      admin: u.role === 'admin',
      teacher: u.role === 'teacher',
    };
  },
  getUserByEmail: async (email: string) => {
    const clean = email.toLowerCase().trim();
    const match = Object.values(tokenMap).find((u) => u.email === clean);
    if (!match) throw new Error('User not found');
    return { uid: match.uid, email: match.email };
  },
} as any);

async function seedFirestoreAndData() {
  // Users
  mockFirestore.store.set(`users/${STUDENT_1.uid}`, {
    uid: STUDENT_1.uid,
    email: STUDENT_1.email,
    name: 'Student One',
    role: 'student',
    level: 'intermediate',
    assignedNativeFriendUID: TEACHER_LINKED.uid,
  });
  mockFirestore.store.set(`users/${STUDENT_2.uid}`, {
    uid: STUDENT_2.uid,
    email: STUDENT_2.email,
    name: 'Student Two',
    role: 'student',
    level: 'advanced',
    assignedNativeFriendUID: TEACHER_UNLINKED.uid,
  });
  mockFirestore.store.set(`users/${TEACHER_LINKED.uid}`, {
    uid: TEACHER_LINKED.uid,
    email: TEACHER_LINKED.email,
    name: 'Teacher Linked',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
  });
  mockFirestore.store.set(`users/${TEACHER_UNLINKED.uid}`, {
    uid: TEACHER_UNLINKED.uid,
    email: TEACHER_UNLINKED.email,
    name: 'Teacher Unlinked',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
  });
  mockFirestore.store.set(`users/${TEACHER_PENDING.uid}`, {
    uid: TEACHER_PENDING.uid,
    email: TEACHER_PENDING.email,
    name: 'Teacher Pending',
    role: 'teacher',
    approvalStatus: 'pending',
    isApproved: false,
  });
  mockFirestore.store.set(`users/${ADMIN_1.uid}`, {
    uid: ADMIN_1.uid,
    email: ADMIN_1.email,
    name: 'Admin User',
    role: 'admin',
  });

  // Tutors collection
  mockFirestore.store.set(`tutors/${TEACHER_LINKED.uid}`, {
    uid: TEACHER_LINKED.uid,
    email: TEACHER_LINKED.email,
    name: 'Teacher Linked',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
  });
  mockFirestore.store.set(`tutors/${TEACHER_UNLINKED.uid}`, {
    uid: TEACHER_UNLINKED.uid,
    email: TEACHER_UNLINKED.email,
    name: 'Teacher Unlinked',
    role: 'teacher',
    approvalStatus: 'approved',
    isApproved: true,
  });
  mockFirestore.store.set(`tutors/${TEACHER_PENDING.uid}`, {
    uid: TEACHER_PENDING.uid,
    email: TEACHER_PENDING.email,
    name: 'Teacher Pending',
    role: 'teacher',
    approvalStatus: 'pending',
    isApproved: false,
  });

  // Lessons
  mockFirestore.store.set('lessons/lesson_arch2f_s1', {
    id: 'lesson_arch2f_s1',
    studentUid: STUDENT_1.uid,
    studentEmail: STUDENT_1.email,
    teacherUid: TEACHER_LINKED.uid,
    teacherEmail: TEACHER_LINKED.email,
    teacherName: 'Teacher Linked',
    sessionDate: '2026-11-12',
    status: 'completed',
    title: 'Fluency Coaching S1',
  });

  mockFirestore.store.set('lessons/lesson_arch2f_s2_cold', {
    id: 'lesson_arch2f_s2_cold',
    studentUid: STUDENT_2.uid,
    studentEmail: STUDENT_2.email,
    teacherUid: TEACHER_UNLINKED.uid,
    teacherEmail: TEACHER_UNLINKED.email,
    teacherName: 'Teacher Unlinked',
    sessionDate: '2026-11-12',
    status: 'completed',
    title: 'Fluency Coaching S2',
    driveFileId: 'drive_cold_s2_lesson',
    liveNotes: 'Private Student 2 Cold Notes',
    sessionNotesDocument: 'Private Student 2 Cold Notes',
  });

  // Seed pedagogical transformations in canonical session_notes/{id}/pedagogical_cache subcollection
  mockFirestore.store.set('session_notes/sess_s2_secret/pedagogical_cache/sess_s2_secret__pt', {
    sessionKey: 'sess_s2_secret',
    lessonId: 'lesson_arch2f_s2_cold',
    sessionDate: '2026-11-12',
    topic: 'Student 2 Private Lesson',
    studentUid: STUDENT_2.uid,
    studentEmail: STUDENT_2.email,
    teacherUid: TEACHER_UNLINKED.uid,
    language: 'pt',
    contentHash: 'hash_s2_secret',
    isAiGenerated: true,
    isProvisional: false,
    mistakesAnalysis: [{ id: 'm1', original: 'I go yesterday', corrected: 'I went yesterday', explanation: 'Past tense', twoExamples: ['I went there.', 'She went home.'], commonPitfalls: 'Avoid go for past' }],
    grammarPoints: [],
    vocabularyAndExpressions: [],
    reviewSummary: { estimatedMinutes: '5 min', keyRules: [], mustKnowVocabulary: [], essentialCorrections: [], rememberThis: 'Use went.' },
    rawNotesSnippet: 'I go yesterday',
  });

  mockFirestore.store.set('session_notes/sess_s1_own/pedagogical_cache/sess_s1_own__pt', {
    sessionKey: 'sess_s1_own',
    lessonId: 'lesson_arch2f_s1',
    sessionDate: '2026-11-12',
    topic: 'Student 1 Private Lesson',
    studentUid: STUDENT_1.uid,
    studentEmail: STUDENT_1.email,
    teacherUid: TEACHER_LINKED.uid,
    language: 'pt',
    contentHash: 'hash_s1_own',
    isAiGenerated: true,
    isProvisional: false,
    mistakesAnalysis: [{ id: 'm1', original: 'I am agree', corrected: 'I agree', explanation: 'Agree is a verb', twoExamples: ['I agree with you.', 'We agree completely.'], commonPitfalls: 'Do not use am before agree' }],
    grammarPoints: [],
    vocabularyAndExpressions: [],
    reviewSummary: { estimatedMinutes: '5 min', keyRules: [], mustKnowVocabulary: [], essentialCorrections: [], rememberThis: 'Say I agree.' },
    rawNotesSnippet: 'I am agree',
  });
}

async function runTests() {
  console.log('=========================================================================');
  console.log('  HOTFIX ARCH.2F.SEC — SUÍTE DE VALIDAÇÃO DE SEGURANÇA & RBAC            ');
  console.log('=========================================================================\n');

  await seedFirestoreAndData();

  // =========================================================================
  // BLOCO 1: REJEIÇÃO 401 SEM TOKEN / INVÁLIDO / EXPIRADO / MALFORMADO
  // =========================================================================
  console.log('--- 1. Autenticação Obrigatória (401) em todas as rotas alvo ---');
  const protectedRoutes = [
    { method: 'GET', url: `/api/session-notes/progress?studentUid=${STUDENT_1.uid}`, body: null },
    { method: 'POST', url: '/api/session-notes/progress', body: { studentUid: STUDENT_1.uid, stepIndex: 1 } },
    { method: 'POST', url: '/api/session-notes/reminder/claim', body: { studentUid: STUDENT_1.uid, dateStr: '2026-11-13' } },
    { method: 'POST', url: '/api/drive/sync-session-notes', body: { studentUid: STUDENT_1.uid, content: 'Notes' } },
    { method: 'GET', url: '/api/drive/files/drive_doc_test', body: null },
    { method: 'GET', url: '/api/drive/files/drive_doc_test/download', body: null },
    { method: 'GET', url: '/api/drive/files', body: null },
    { method: 'GET', url: '/api/drive/files/a/b', body: null },
    { method: 'GET', url: '/api/pedagogical-notes', body: null },
  ];

  for (const r of protectedRoutes) {
    const noTok = await simulateRequest(r.method, r.url, {}, r.body);
    assert(noTok.status === 401, `${r.method} ${r.url} sem token retorna 401`, `status=${noTok.status}`);

    const badTok = await simulateRequest(r.method, r.url, { Authorization: 'Bearer invalid-token' }, r.body);
    assert(badTok.status === 401, `${r.method} ${r.url} com token inválido retorna 401`, `status=${badTok.status}`);

    const expTok = await simulateRequest(r.method, r.url, { Authorization: 'Bearer expired-token' }, r.body);
    assert(expTok.status === 401, `${r.method} ${r.url} com token expirado retorna 401`, `status=${expTok.status}`);

    const malTok = await simulateRequest(r.method, r.url, { Authorization: 'Basic abc' }, r.body);
    assert(malTok.status === 401, `${r.method} ${r.url} com header malformado retorna 401`, `status=${malTok.status}`);
  }

  // =========================================================================
  // BLOCO 2: UID CANÔNICO & PROGRESSO (/api/session-notes/progress)
  // =========================================================================
  console.log('\n--- 2. Segurança /api/session-notes/progress (GET & POST) ---');
  {
    const synRes = await simulateRequest('GET', '/api/session-notes/progress', { Authorization: 'Bearer tok-synthetic' });
    assert(synRes.status === 403, 'Caller com UID sintético (usr-*) recebe 403 em GET /api/session-notes/progress');

    const postOwn = await simulateRequest(
      'POST',
      '/api/session-notes/progress',
      { Authorization: 'Bearer tok-student-1' },
      { studentUid: STUDENT_1.uid, studentEmail: STUDENT_1.email, lastSessionKey: 'sess_s1_own', stepIndex: 1, lastAssignedDate: '2026-11-13' }
    );
    assert(postOwn.status === 200 && postOwn.body?.progress?.studentUid === STUDENT_1.uid, 'Aluno 1 salva próprio progresso (200) com UID canônico');

    const getOwn = await simulateRequest(
      'GET',
      `/api/session-notes/progress?studentUid=${STUDENT_1.uid}`,
      { Authorization: 'Bearer tok-student-1' }
    );
    assert(getOwn.status === 200 && getOwn.body?.stepIndex === 1, 'Aluno 1 lê próprio progresso (200)');

    const getOwnNoParam = await simulateRequest(
      'GET',
      '/api/session-notes/progress',
      { Authorization: 'Bearer tok-student-1' }
    );
    assert(getOwnNoParam.status === 200 && getOwnNoParam.body?.stepIndex === 1, 'Aluno 1 lê próprio progresso mesmo sem query params (lock no caller.uid)');

    const getCrossUid = await simulateRequest(
      'GET',
      `/api/session-notes/progress?studentUid=${STUDENT_2.uid}`,
      { Authorization: 'Bearer tok-student-1' }
    );
    assert(getCrossUid.status === 403, 'Aluno 1 tentando ler progresso do Aluno 2 por UID recebe 403');

    const getCrossEmail = await simulateRequest(
      'GET',
      `/api/session-notes/progress?studentEmail=${encodeURIComponent(STUDENT_2.email)}`,
      { Authorization: 'Bearer tok-student-1' }
    );
    assert(getCrossEmail.status === 403, 'Aluno 1 tentando ler progresso do Aluno 2 por email recebe 403');

    const postCross = await simulateRequest(
      'POST',
      '/api/session-notes/progress',
      { Authorization: 'Bearer tok-student-1' },
      { studentUid: STUDENT_2.uid, stepIndex: 2 }
    );
    assert(postCross.status === 403, 'Aluno 1 tentando alterar progresso do Aluno 2 recebe 403');

    const postTeacherLinked = await simulateRequest(
      'POST',
      '/api/session-notes/progress',
      { Authorization: 'Bearer tok-teacher-linked' },
      { studentUid: STUDENT_1.uid, stepIndex: 2 }
    );
    assert(postTeacherLinked.status === 403, 'Professor (mesmo vinculado) é impedido de alterar progresso pessoal do aluno em POST (403)');

    const postTeacherPending = await simulateRequest(
      'POST',
      '/api/session-notes/progress',
      { Authorization: 'Bearer tok-teacher-pending' },
      { studentUid: STUDENT_1.uid, stepIndex: 2 }
    );
    assert(postTeacherPending.status === 403, 'Professor pendente é impedido em POST progress (403)');

    const getTeacherLinked = await simulateRequest(
      'GET',
      `/api/session-notes/progress?studentUid=${STUDENT_1.uid}`,
      { Authorization: 'Bearer tok-teacher-linked' }
    );
    assert(getTeacherLinked.status === 200 && getTeacherLinked.body?.stepIndex === 1, 'Professor aprovado e vinculado lê progresso do Aluno 1 (200)');

    const getTeacherUnlinked = await simulateRequest(
      'GET',
      `/api/session-notes/progress?studentUid=${STUDENT_1.uid}`,
      { Authorization: 'Bearer tok-teacher-unlinked' }
    );
    assert(getTeacherUnlinked.status === 403, 'Professor aprovado SEM vínculo com Aluno 1 recebe 403 em GET progress');

    const getTeacherPending = await simulateRequest(
      'GET',
      `/api/session-notes/progress?studentUid=${STUDENT_1.uid}`,
      { Authorization: 'Bearer tok-teacher-pending' }
    );
    assert(getTeacherPending.status === 403, 'Professor PENDENTE recebe 403 em GET progress');

    const postAdmin = await simulateRequest(
      'POST',
      '/api/session-notes/progress',
      { Authorization: 'Bearer tok-admin-1' },
      { studentUid: STUDENT_2.uid, lastSessionKey: 'sess_s2_secret', stepIndex: 2 }
    );
    assert(postAdmin.status === 200 && postAdmin.body?.progress?.stepIndex === 2, 'Admin atualiza progresso de aluno por UID canônico (200)');

    const getAdmin = await simulateRequest(
      'GET',
      `/api/session-notes/progress?studentUid=${STUDENT_2.uid}`,
      { Authorization: 'Bearer tok-admin-1' }
    );
    assert(getAdmin.status === 200 && getAdmin.body?.stepIndex === 2, 'Admin consulta progresso de aluno (200)');
  }

  // =========================================================================
  // BLOCO 3: CLAIM DE LEMBRETE (/api/session-notes/reminder/claim)
  // =========================================================================
  console.log('\n--- 3. Segurança /api/session-notes/reminder/claim ---');
  {
    const crossClaim = await simulateRequest(
      'POST',
      '/api/session-notes/reminder/claim',
      { Authorization: 'Bearer tok-student-1' },
      { studentUid: STUDENT_2.uid, studentEmail: STUDENT_2.email, dateStr: '2026-11-13' }
    );
    assert(crossClaim.status === 403, 'Aluno 1 tentando dar claim no lembrete do Aluno 2 recebe 403');

    const crossClaimEmail = await simulateRequest(
      'POST',
      '/api/session-notes/reminder/claim',
      { Authorization: 'Bearer tok-student-1' },
      { studentEmail: STUDENT_2.email, dateStr: '2026-11-13' }
    );
    assert(crossClaimEmail.status === 403, 'Aluno 1 tentando dar claim no lembrete do Aluno 2 via email recebe 403');

    const teacherClaim = await simulateRequest(
      'POST',
      '/api/session-notes/reminder/claim',
      { Authorization: 'Bearer tok-teacher-linked' },
      { studentUid: STUDENT_1.uid, dateStr: '2026-11-13' }
    );
    assert(teacherClaim.status === 403, 'Professor (mesmo vinculado) é impedido de dar claim no lembrete do aluno (403)');

    const pendingClaim = await simulateRequest(
      'POST',
      '/api/session-notes/reminder/claim',
      { Authorization: 'Bearer tok-teacher-pending' },
      { studentUid: STUDENT_1.uid, dateStr: '2026-11-13' }
    );
    assert(pendingClaim.status === 403, 'Professor pendente é bloqueado em reminder claim (403)');

    const ownClaim1 = await simulateRequest(
      'POST',
      '/api/session-notes/reminder/claim',
      { Authorization: 'Bearer tok-student-1' },
      { studentUid: STUDENT_1.uid, studentEmail: STUDENT_1.email, dateStr: '2026-11-13' }
    );
    assert(ownClaim1.status === 200 && ownClaim1.body?.canShow === true, 'Aluno 1 realiza primeiro claim diário com sucesso (canShow: true)');

    const ownClaim2 = await simulateRequest(
      'POST',
      '/api/session-notes/reminder/claim',
      { Authorization: 'Bearer tok-student-1' },
      { studentUid: STUDENT_1.uid, studentEmail: STUDENT_1.email, dateStr: '2026-11-13' }
    );
    assert(ownClaim2.status === 200 && ownClaim2.body?.canShow === false && ownClaim2.body?.alreadyShown === true, 'Segundo claim do Aluno 1 no mesmo dia é idempotente (canShow: false)');

    // Ensure Student 2's claim wasn't consumed by Student 1's cross attack
    const s2OwnClaim = await simulateRequest(
      'POST',
      '/api/session-notes/reminder/claim',
      { Authorization: 'Bearer tok-student-2' },
      { studentUid: STUDENT_2.uid, dateStr: '2026-11-13' }
    );
    assert(s2OwnClaim.status === 200 && s2OwnClaim.body?.canShow === true, 'Claim do Aluno 2 permaneceu intacto após tentativa de ataque do Aluno 1');
  }

  // =========================================================================
  // BLOCO 4: GOOGLE DRIVE SYNC & FILES (/api/drive/sync-session-notes e /api/drive/files/*)
  // =========================================================================
  console.log('\n--- 4. Segurança Google Drive Sync & Files ---');
  let syncedFileId = '';
  {
    const studentSync = await simulateRequest(
      'POST',
      '/api/drive/sync-session-notes',
      { Authorization: 'Bearer tok-student-1' },
      { studentUid: STUDENT_1.uid, lessonId: 'lesson_arch2f_s1', content: 'Student forged note' }
    );
    assert(studentSync.status === 403, 'Aluno é impedido de sincronizar notas no Drive (403)');

    const pendingSync = await simulateRequest(
      'POST',
      '/api/drive/sync-session-notes',
      { Authorization: 'Bearer tok-teacher-pending' },
      { studentUid: STUDENT_1.uid, lessonId: 'lesson_arch2f_s1', content: 'Pending teacher note' }
    );
    assert(pendingSync.status === 403, 'Professor pendente é impedido de sincronizar notas no Drive (403)');

    const unlinkedSync = await simulateRequest(
      'POST',
      '/api/drive/sync-session-notes',
      { Authorization: 'Bearer tok-teacher-unlinked' },
      { studentUid: STUDENT_1.uid, content: 'Unlinked teacher note', sessionDate: '2026-11-13' }
    );
    assert(unlinkedSync.status === 403, 'Professor sem vínculo pedagógico com Aluno 1 recebe 403 no Drive Sync');

    const spoofTeacherSync = await simulateRequest(
      'POST',
      '/api/drive/sync-session-notes',
      { Authorization: 'Bearer tok-teacher-linked' },
      { studentUid: STUDENT_1.uid, teacherUid: TEACHER_UNLINKED.uid, content: 'Spoofed teacher' }
    );
    assert(spoofTeacherSync.status === 403, 'Spoofing de teacherUid no Drive Sync retorna 403');

    const badUidSync = await simulateRequest(
      'POST',
      '/api/drive/sync-session-notes',
      { Authorization: 'Bearer tok-teacher-linked' },
      { studentUid: 'usr-synthetic-99', content: 'Bad UID' }
    );
    assert(badUidSync.status === 400, 'studentUid não canônico no Drive Sync retorna 400');

    const linkedSync = await simulateRequest(
      'POST',
      '/api/drive/sync-session-notes',
      { Authorization: 'Bearer tok-teacher-linked' },
      {
        studentUid: STUDENT_1.uid,
        studentEmail: STUDENT_1.email,
        studentName: 'Student One',
        lessonId: 'lesson_arch2f_s1',
        sessionDate: '2026-11-12',
        topic: 'Fluency Coaching S1',
        content: 'Approved pedagogical note content for Student 1.',
      }
    );
    assert(linkedSync.status === 200 && linkedSync.body?.success === true && Boolean(linkedSync.body?.fileId), 'Professor aprovado e vinculado sincroniza Drive com sucesso (200)');
    syncedFileId = linkedSync.body?.fileId;

    // Cross-teacher overwrite protection on existingFileId
    const hijackSync = await simulateRequest(
      'POST',
      '/api/drive/sync-session-notes',
      { Authorization: 'Bearer tok-teacher-unlinked' },
      {
        studentUid: STUDENT_2.uid,
        existingFileId: syncedFileId,
        content: 'Hijack attempt',
      }
    );
    assert(hijackSync.status === 403, 'Outro professor tentando sobrescrever existingFileId alheio recebe 403');

    // View & Download RBAC checks for syncedFileId
    const viewS1 = await simulateRequest('GET', `/api/drive/files/${syncedFileId}`, { Authorization: 'Bearer tok-student-1' });
    assert(viewS1.status === 200 && String(viewS1.body).includes('Approved pedagogical note content for Student 1'), 'Aluno proprietário visualiza arquivo Drive (200)');

    const dlS1 = await simulateRequest('GET', `/api/drive/files/${syncedFileId}/download`, { Authorization: 'Bearer tok-student-1' });
    assert(dlS1.status === 200 && String(dlS1.body).includes('Approved pedagogical note content for Student 1'), 'Aluno proprietário baixa arquivo Drive (200)');

    const viewS2 = await simulateRequest('GET', `/api/drive/files/${syncedFileId}`, { Authorization: 'Bearer tok-student-2' });
    assert(viewS2.status === 403, 'Outro aluno tentando visualizar arquivo Drive do Aluno 1 recebe 403');

    const dlS2 = await simulateRequest('GET', `/api/drive/files/${syncedFileId}/download`, { Authorization: 'Bearer tok-student-2' });
    assert(dlS2.status === 403, 'Outro aluno tentando baixar arquivo Drive do Aluno 1 recebe 403');

    const viewUnlinked = await simulateRequest('GET', `/api/drive/files/${syncedFileId}`, { Authorization: 'Bearer tok-teacher-unlinked' });
    assert(viewUnlinked.status === 403, 'Professor sem vínculo tentando visualizar arquivo Drive recebe 403');

    const dlUnlinked = await simulateRequest('GET', `/api/drive/files/${syncedFileId}/download`, { Authorization: 'Bearer tok-teacher-unlinked' });
    assert(dlUnlinked.status === 403, 'Professor sem vínculo tentando baixar arquivo Drive recebe 403');

    const viewPending = await simulateRequest('GET', `/api/drive/files/${syncedFileId}`, { Authorization: 'Bearer tok-teacher-pending' });
    assert(viewPending.status === 403, 'Professor pendente tentando visualizar arquivo Drive recebe 403');

    const viewLinked = await simulateRequest('GET', `/api/drive/files/${syncedFileId}`, { Authorization: 'Bearer tok-teacher-linked' });
    assert(viewLinked.status === 200, 'Professor aprovado e vinculado visualiza arquivo Drive (200)');

    const viewAdmin = await simulateRequest('GET', `/api/drive/files/${syncedFileId}`, { Authorization: 'Bearer tok-admin-1' });
    assert(viewAdmin.status === 200, 'Administrador visualiza arquivo Drive (200)');

    const dlAdmin = await simulateRequest('GET', `/api/drive/files/${syncedFileId}/download`, { Authorization: 'Bearer tok-admin-1' });
    assert(dlAdmin.status === 200, 'Administrador baixa arquivo Drive (200)');

    // Lesson-backed cold Drive file fallback isolation (Student 2's file not in StoredDriveFile)
    const coldS1Deny = await simulateRequest('GET', '/api/drive/files/drive_cold_s2_lesson', { Authorization: 'Bearer tok-student-1' });
    assert(coldS1Deny.status === 403, 'Aluno 1 bloqueado com 403 ao acessar arquivo Drive de lição do Aluno 2 no Firestore');

    const coldS2Ok = await simulateRequest('GET', '/api/drive/files/drive_cold_s2_lesson', { Authorization: 'Bearer tok-student-2' });
    assert(coldS2Ok.status === 200 && String(coldS2Ok.body).includes('Private Student 2 Cold Notes'), 'Aluno 2 acessa próprio arquivo Drive persistido em lessons (200)');

    const catchAllAuth = await simulateRequest('GET', '/api/drive/files/sub/unknown', { Authorization: 'Bearer tok-student-1' });
    assert(catchAllAuth.status === 404, 'Rota não correspondente em /api/drive/files/* autenticada retorna 404');
  }

  // =========================================================================
  // BLOCO 5: ISOLAMENTO GET /api/pedagogical-notes (COM E SEM PARÂMETROS)
  // =========================================================================
  console.log('\n--- 5. Isolamento /api/pedagogical-notes (incluindo studentUid ou sessionKey ausentes) ---');
  {
    // Populate in-memory cache via valid authorized fetches first to test both in-memory & Firestore isolation
    const warmS1 = await simulateRequest(
      'GET',
      `/api/pedagogical-notes?sessionKey=sess_s1_own&language=pt`,
      { Authorization: 'Bearer tok-student-1' }
    );
    assert(warmS1.status === 200 && warmS1.body?.studentUid === STUDENT_1.uid, 'Aluno 1 consulta própria transformation sem precisar passar studentUid (200)');

    const warmS2 = await simulateRequest(
      'GET',
      `/api/pedagogical-notes?sessionKey=sess_s2_secret&language=pt`,
      { Authorization: 'Bearer tok-student-2' }
    );
    assert(warmS2.status === 200 && warmS2.body?.studentUid === STUDENT_2.uid, 'Aluno 2 consulta própria transformation (200)');

    // 5.1 Student 1 querying Student 2's sessionKey WITHOUT studentUid
    const s1ProbeKey = await simulateRequest(
      'GET',
      '/api/pedagogical-notes?sessionKey=sess_s2_secret&language=pt',
      { Authorization: 'Bearer tok-student-1' }
    );
    assert(s1ProbeKey.status === 403, 'Aluno 1 consultando sessionKey do Aluno 2 COM studentUid ausente recebe 403');

    // 5.2 Student 1 querying Student 2's lessonId WITHOUT studentUid
    const s1ProbeLesson = await simulateRequest(
      'GET',
      '/api/pedagogical-notes?lessonId=lesson_arch2f_s2_cold',
      { Authorization: 'Bearer tok-student-1' }
    );
    assert(s1ProbeLesson.status === 403, 'Aluno 1 consultando lessonId do Aluno 2 COM studentUid ausente recebe 403');

    // 5.3 Student 1 querying with BOTH sessionKey and studentUid ABSENT
    const s1List = await simulateRequest(
      'GET',
      '/api/pedagogical-notes',
      { Authorization: 'Bearer tok-student-1' }
    );
    assert(
      s1List.status === 200 &&
        Array.isArray(s1List.body) &&
        s1List.body.every((item: any) => item.studentUid === STUDENT_1.uid),
      'Aluno 1 sem sessionKey e sem studentUid recebe apenas os próprios registros (zero vazamento do Aluno 2)'
    );

    // 5.4 Approved UNLINKED teacher querying Student 2's sessionKey WITHOUT studentUid (or WITH studentUid WITHOUT sessionKey)
    const tLinkedProbeS2Key = await simulateRequest(
      'GET',
      '/api/pedagogical-notes?sessionKey=sess_s2_secret',
      { Authorization: 'Bearer tok-teacher-linked' }
    );
    assert(tLinkedProbeS2Key.status === 403, 'Professor não vinculado ao Aluno 2 consultando sessionKey do Aluno 2 (sem studentUid) recebe 403');

    const tLinkedProbeS2Uid = await simulateRequest(
      'GET',
      `/api/pedagogical-notes?studentUid=${STUDENT_2.uid}`,
      { Authorization: 'Bearer tok-teacher-linked' }
    );
    assert(tLinkedProbeS2Uid.status === 403, 'Professor não vinculado ao Aluno 2 consultando studentUid do Aluno 2 (sem sessionKey) recebe 403');

    // 5.5 Approved teacher querying with BOTH sessionKey AND studentUid ABSENT
    const tLinkedList = await simulateRequest(
      'GET',
      '/api/pedagogical-notes',
      { Authorization: 'Bearer tok-teacher-linked' }
    );
    assert(
      tLinkedList.status === 200 &&
        Array.isArray(tLinkedList.body) &&
        tLinkedList.body.every((item: any) => item.studentUid === STUDENT_1.uid) &&
        !tLinkedList.body.some((item: any) => item.studentUid === STUDENT_2.uid),
      'Professor vinculado sem sessionKey e sem studentUid recebe apenas alunos vinculados (zero dados de outros alunos)'
    );

    // 5.6 Approved teacher querying linked Student 1's sessionKey WITHOUT studentUid
    const tLinkedS1Ok = await simulateRequest(
      'GET',
      '/api/pedagogical-notes?sessionKey=sess_s1_own',
      { Authorization: 'Bearer tok-teacher-linked' }
    );
    assert(tLinkedS1Ok.status === 200 && tLinkedS1Ok.body?.studentUid === STUDENT_1.uid, 'Professor vinculado consulta nota do Aluno 1 por sessionKey (200)');

    // 5.7 Pending teacher blocked with 403 even with no params
    const tPendingList = await simulateRequest(
      'GET',
      '/api/pedagogical-notes',
      { Authorization: 'Bearer tok-teacher-pending' }
    );
    assert(tPendingList.status === 403, 'Professor pendente recebe 403 em GET /api/pedagogical-notes mesmo sem parâmetros');

    // 5.8 Admin sees all or filtered
    const adminListAll = await simulateRequest(
      'GET',
      '/api/pedagogical-notes',
      { Authorization: 'Bearer tok-admin-1' }
    );
    assert(
      adminListAll.status === 200 &&
        Array.isArray(adminListAll.body) &&
        adminListAll.body.some((i: any) => i.studentUid === STUDENT_1.uid) &&
        adminListAll.body.some((i: any) => i.studentUid === STUDENT_2.uid),
      'Administrador consulta notas pedagógicas com visibilidade administrativa (200)'
    );
  }

  // =========================================================================
  // BLOCO 6: REGRESSÃO DO FLUXO APPLY AI -> APPROVE & PUBLISH -> DRIVE -> PROGRESS -> CLAIM
  // =========================================================================
  console.log('\n--- 6. Regressão: Apply AI -> Approve & Publish -> Drive Sync -> Reminder/Progress ---');
  {
    setSessionNoteTransformAttemptExecutorForTesting(async () => ({
      mistakesAnalysis: [
        {
          id: 'mistake-1',
          original: 'I have a doubt about this',
          corrected: 'I have a question about this',
          category: 'word-choice',
          explanation: 'In English, use "question" when asking for information.',
          grammarRule: 'Question vs Doubt collocation',
          twoExamples: ['I have a question about the schedule.', 'Feel free to ask a question.'],
          commonPitfalls: 'Avoid translating "dúvida" directly as "doubt" when asking a question.',
        },
      ],
      grammarPoints: [
        {
          id: 'grammar-1',
          topic: 'Have a question vs Doubt',
          rule: 'Use "have a question" to ask for clarification.',
          form: 'Subject + have + a question + about + noun',
          usage: 'Everyday and professional English.',
          examples: ['I have a quick question about the report.'],
          commonMistakes: 'Saying "I have a doubt" instead of "I have a question".',
          comparisons: 'Doubt expresses disbelief/uncertainty.',
        },
      ],
      vocabularyAndExpressions: [
        {
          id: 'vocab-1',
          term: 'follow up',
          partOfSpeech: 'Phrasal Verb',
          definitionEn: 'To check on the progress of something.',
          simpleDefinition: 'Check back on something later.',
          collocations: ['follow up on an email', 'follow up with a client'],
          realExamples: ['I will follow up with the team tomorrow morning.'],
          synonyms: ['check back', 'revisit'],
          register: 'neutral',
          category: 'Workplace Communication',
          isNewWord: true,
          isPronunciationFocus: false,
        },
      ],
      reviewSummary: {
        estimatedMinutes: '5–10 minutes',
        keyRules: ['Use "have a question" instead of "have a doubt".'],
        mustKnowVocabulary: ['follow up'],
        essentialCorrections: [{ original: 'I have a doubt about this', corrected: 'I have a question about this' }],
        usefulPatterns: ['I have a question about...'],
        rememberThis: 'Say "I have a question" whenever you want clarification!',
      },
    }));

    const saveRes = await simulateRequest(
      'POST',
      '/api/session-notes',
      { Authorization: 'Bearer tok-teacher-linked' },
      {
        lessonId: 'lesson_arch2f_s1',
        studentUid: STUDENT_1.uid,
        studentEmail: STUDENT_1.email,
        sessionDate: '2026-11-12',
        topic: 'Business Follow-ups',
        rawContent: '<p><span data-tag-type="incorrect">I have a doubt about this</span> -&gt; I have a question about this. <span data-tag-type="new-word">follow up</span></p>',
      }
    );
    assert(saveRes.status === 200 && saveRes.body?.success === true, 'Professor vinculado salva nota bruta com sucesso');

    const transformRes = await simulateRequest(
      'POST',
      '/api/session-notes/lesson_arch2f_s1/transform',
      { Authorization: 'Bearer tok-teacher-linked' },
      { language: 'en' }
    );
    assert(transformRes.status === 200 && Boolean(transformRes.body?.draftTransformation?.draftId), 'Apply AI gera rascunho pedagógico com sucesso (200)');

    const approveRes = await simulateRequest(
      'POST',
      '/api/session-notes/lesson_arch2f_s1/approve',
      { Authorization: 'Bearer tok-teacher-linked' },
      { draftId: transformRes.body?.draftTransformation?.draftId }
    );
    assert(
      approveRes.status === 200 && approveRes.body?.approvalStatus === 'approved' && Boolean(approveRes.body?.approvedVersion),
      'Approve & Publish publica versão aprovada com sucesso (200)'
    );

    const driveSyncAfterApprove = await simulateRequest(
      'POST',
      '/api/drive/sync-session-notes',
      { Authorization: 'Bearer tok-teacher-linked' },
      {
        studentUid: STUDENT_1.uid,
        studentEmail: STUDENT_1.email,
        lessonId: 'lesson_arch2f_s1',
        sessionDate: '2026-11-12',
        topic: 'Business Follow-ups',
        content: 'Approved content for Drive sync after Approve & Publish.',
      }
    );
    assert(driveSyncAfterApprove.status === 200 && driveSyncAfterApprove.body?.success === true, 'Sync Drive após Approve & Publish funciona sem regressão (200)');

    const studentNotesRes = await simulateRequest(
      'GET',
      `/api/session-notes?lessonId=lesson_arch2f_s1`,
      { Authorization: 'Bearer tok-student-1' }
    );
    assert(
      studentNotesRes.status === 200 && studentNotesRes.body?.approvalStatus === 'approved',
      'Aluno 1 visualiza anotação aprovada após fluxo completo (200)'
    );

    setSessionNoteTransformAttemptExecutorForTesting(null);
  }

  // Restore db.json backup if existed
  if (dbBackup !== null) {
    fs.writeFileSync(DB_PATH, dbBackup, 'utf-8');
  }

  console.log('\n=========================================================================');
  console.log(`ARCH.2F.SEC RESULTADOS: ${passed} APROVADOS, ${failed} FALHAS`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Erro fatal executando suíte ARCH.2F.SEC:', err);
  if (dbBackup !== null) {
    try {
      fs.writeFileSync(DB_PATH, dbBackup, 'utf-8');
    } catch {}
  }
  process.exit(1);
});
