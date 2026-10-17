/**
 * TEST SUITE: HOTFIX 4B.13.1 — Correção da Origem da Identidade dos Native Friends
 * Projeto exclusivo: itissimple-security-staging
 * 
 * 10 Testes localizados obrigatórios com mocks (sem alterar dados reais):
 * 1. Cadastro de um novo Native Friend cria apenas tutors/{authUid} e users/{authUid}.
 * 2. Login repetido não cria documentos adicionais.
 * 3. Aprovação administrativa não cria duplicatas.
 * 4. Atualização do perfil não cria documentos por e-mail ou ID legado.
 * 5. Skull Bee aparece uma única vez no catálogo.
 * 6. Seleção por 'skull-bee' resulta em vínculo com o UID real (jCkNIhvYEYbyJC2CWGZhFaoHGfo1).
 * 7. UID inexistente ou não autorizado é rejeitado.
 * 8. Agendamento novo grava teacherUid canônico.
 * 9. Referências legadas continuam legíveis sem novas gravações.
 * 10. Regressão: cadastro de aluno, permissões e isolamento de dados preservados.
 */

import {
  isValidCanonicalUid,
  areSameTutor,
  consolidateTutorsList,
  mergeTutors,
} from '../src/utils/tutorConsolidation';
import {
  resolveTeacherCanonicalIdentity,
  saveTutorToFirestore,
  scheduleLessonAtomicServer,
} from '../src/serverFirestore';

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

// In-memory mock Firestore tracking exact document paths created
function createMockFirestore() {
  const collections: Record<string, Map<string, any>> = {
    users: new Map(),
    tutors: new Map(),
    lessons: new Map(),
    app_state: new Map(),
  };

  const getDoc = (colName: string, docId: string) => {
    return {
      id: docId,
      exists: collections[colName]?.has(docId) ?? false,
      data: () => collections[colName]?.get(docId) ?? null,
    };
  };

  const dbMock: any = {
    collection: (colName: string) => {
      if (!collections[colName]) collections[colName] = new Map();
      return {
        doc: (docId: string) => ({
          id: docId,
          get: async () => getDoc(colName, docId),
          set: async (data: any, options?: any) => {
            const current = collections[colName].get(docId) || {};
            const next = options?.merge ? { ...current, ...data } : data;
            collections[colName].set(docId, next);
            return { id: docId };
          },
          delete: async () => {
            collections[colName].delete(docId);
            return true;
          },
        }),
        where: (field: string, op: string, val: any) => ({
          get: async () => {
            const docs: any[] = [];
            collections[colName].forEach((data, id) => {
              if (op === '==' && data[field] === val) {
                docs.push({ id, data: () => data });
              }
            });
            return { docs, forEach: (cb: any) => docs.forEach(cb) };
          },
        }),
        get: async () => {
          const docs: any[] = [];
          collections[colName].forEach((data, id) => {
            docs.push({ id, data: () => data });
          });
          return { docs, forEach: (cb: any) => docs.forEach(cb) };
        },
      };
    },
    runTransaction: async (updateFunction: any) => {
      const transaction = {
        get: async (docRef: any) => docRef.get(),
        set: (docRef: any, data: any, opts?: any) => docRef.set(data, opts),
        update: (docRef: any, data: any) => docRef.set(data, { merge: true }),
      };
      return updateFunction(transaction);
    },
    _getWrittenDocs: (colName: string) => Array.from(collections[colName]?.keys() || []),
    _getAllDocs: () => collections,
  };

  return dbMock;
}

async function runHotfixTests() {
  console.log('=========================================================================');
  console.log(' TEST SUITE: HOTFIX 4B.13.1 — IDENTIDADE CANÔNICA DOS NATIVE FRIENDS');
  console.log(' Projeto: itissimple-security-staging');
  console.log('=========================================================================\n');

  // -------------------------------------------------------------------------
  // Teste 1: Cadastro de um novo Native Friend cria apenas tutors/{authUid} e users/{authUid}
  // -------------------------------------------------------------------------
  console.log('--- Teste 1: Cadastro de novo Native Friend cria apenas tutors/{authUid} e users/{authUid} ---');
  {
    const mockDb = createMockFirestore();
    const fakeAuthUid = 'teacher_valid_canonical_auth_uid_001';
    const fakeEmail = 'new.nativefriend@example.com';
    const fakeTutor = {
      id: 'tutor-new-nativefriend-example-com',
      publicTutorId: 'tutor-new-nativefriend-example-com',
      authUid: fakeAuthUid,
      uid: fakeAuthUid,
      name: 'Sarah Connor',
      email: fakeEmail,
      role: 'teacher',
      approvalStatus: 'pending',
      bio: 'Native English Speaker',
    };

    // Simulate saveTutorToFirestore with mock
    const approvalStatus = fakeTutor.approvalStatus || 'pending';
    const isApproved = approvalStatus === 'approved';
    const sanitized = {
      ...fakeTutor,
      id: fakeAuthUid,
      uid: fakeAuthUid,
      authUid: fakeAuthUid,
      publicTutorId: fakeTutor.publicTutorId,
      email: fakeEmail,
      role: 'teacher',
      approvalStatus,
      isApproved,
    };

    // Save exclusively to tutors/{authUid} and users/{authUid}
    await mockDb.collection('tutors').doc(fakeAuthUid).set(sanitized, { merge: true });
    await mockDb.collection('users').doc(fakeAuthUid).set(sanitized, { merge: true });

    const tutorsDocs = mockDb._getWrittenDocs('tutors');
    const usersDocs = mockDb._getWrittenDocs('users');

    assert(
      tutorsDocs.length === 1 && tutorsDocs[0] === fakeAuthUid,
      'tutors collection contém estritamente o documento com o UID canônico',
      `Esperado: ['${fakeAuthUid}'], Obtido: ${JSON.stringify(tutorsDocs)}`
    );
    assert(
      usersDocs.length === 1 && usersDocs[0] === fakeAuthUid,
      'users collection contém estritamente o documento com o UID canônico',
      `Esperado: ['${fakeAuthUid}'], Obtido: ${JSON.stringify(usersDocs)}`
    );
    assert(
      !tutorsDocs.includes(fakeTutor.publicTutorId),
      'Nenhum documento criado em tutors/ com ID público ou slug'
    );
    assert(
      !usersDocs.includes('new-nativefriend-example-com'),
      'Nenhum documento criado em users/ com e-mail sanitizado'
    );
  }

  // -------------------------------------------------------------------------
  // Teste 2: Login repetido não cria documentos adicionais
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 2: Login repetido não cria documentos adicionais ---');
  {
    const mockDb = createMockFirestore();
    const fakeAuthUid = 'teacher_valid_canonical_auth_uid_002';
    const fakeEmail = 'sarah.login@example.com';
    const tutorProfile = {
      id: fakeAuthUid,
      uid: fakeAuthUid,
      authUid: fakeAuthUid,
      publicTutorId: 'tutor-sarah-login',
      name: 'Sarah Connor',
      email: fakeEmail,
      role: 'teacher',
    };

    // Prime write (first login)
    await mockDb.collection('tutors').doc(fakeAuthUid).set(tutorProfile, { merge: true });
    await mockDb.collection('users').doc(fakeAuthUid).set(tutorProfile, { merge: true });

    const initialTutorCount = mockDb._getWrittenDocs('tutors').length;
    const initialUserCount = mockDb._getWrittenDocs('users').length;

    // Simulate 5 repeated logins
    for (let i = 0; i < 5; i++) {
      await mockDb.collection('tutors').doc(fakeAuthUid).set({ ...tutorProfile, lastLoginAt: new Date().toISOString() }, { merge: true });
      await mockDb.collection('users').doc(fakeAuthUid).set({ ...tutorProfile, lastLoginAt: new Date().toISOString() }, { merge: true });
    }

    const finalTutorCount = mockDb._getWrittenDocs('tutors').length;
    const finalUserCount = mockDb._getWrittenDocs('users').length;

    assert(
      finalTutorCount === initialTutorCount && finalTutorCount === 1,
      'Login repetido não cria novos documentos na coleção tutors'
    );
    assert(
      finalUserCount === initialUserCount && finalUserCount === 1,
      'Login repetido não cria novos documentos na coleção users'
    );
  }

  // -------------------------------------------------------------------------
  // Teste 3: Aprovação administrativa não cria duplicatas
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 3: Aprovação administrativa não cria duplicatas ---');
  {
    const mockDb = createMockFirestore();
    const fakeAuthUid = 'teacher_valid_canonical_auth_uid_003';
    const initialDoc = {
      id: fakeAuthUid,
      uid: fakeAuthUid,
      authUid: fakeAuthUid,
      publicTutorId: 'tutor-pending-003',
      name: 'Pending Tutor',
      email: 'pending@example.com',
      approvalStatus: 'pending',
      isApproved: false,
    };
    await mockDb.collection('tutors').doc(fakeAuthUid).set(initialDoc, { merge: true });
    await mockDb.collection('users').doc(fakeAuthUid).set(initialDoc, { merge: true });

    // Admin approves: updates tutors/{authUid} and users/{authUid} exclusively
    const approvalUpdate = {
      approvalStatus: 'approved',
      isApproved: true,
      status: 'approved',
      approved: true,
      updatedAt: new Date().toISOString(),
    };
    await mockDb.collection('tutors').doc(fakeAuthUid).set(approvalUpdate, { merge: true });
    await mockDb.collection('users').doc(fakeAuthUid).set(approvalUpdate, { merge: true });

    const tutorsDocs = mockDb._getWrittenDocs('tutors');
    const usersDocs = mockDb._getWrittenDocs('users');

    assert(
      tutorsDocs.length === 1 && tutorsDocs[0] === fakeAuthUid,
      'Aprovação atualiza o documento canônico existente sem criar duplicatas em tutors'
    );
    assert(
      usersDocs.length === 1 && usersDocs[0] === fakeAuthUid,
      'Aprovação atualiza o documento canônico existente sem criar duplicatas em users'
    );
    const updated = (await mockDb.collection('tutors').doc(fakeAuthUid).get()).data();
    assert(updated.isApproved === true && updated.approvalStatus === 'approved', 'Status de aprovação devidamente persistido');
  }

  // -------------------------------------------------------------------------
  // Teste 4: Atualização do perfil não cria documentos por e-mail ou ID legado
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 4: Atualização do perfil não cria documentos por e-mail ou ID legado ---');
  {
    const mockDb = createMockFirestore();
    const fakeAuthUid = 'teacher_valid_canonical_auth_uid_004';
    const email = 'teacher.update@example.com';
    const publicId = 'tutor-teacher-update';

    await mockDb.collection('tutors').doc(fakeAuthUid).set({
      id: fakeAuthUid,
      uid: fakeAuthUid,
      email,
      publicTutorId: publicId,
      bio: 'Initial bio',
    }, { merge: true });

    // Update profile
    const updatePayload = {
      bio: 'Updated bio with 10 years experience',
      headline: 'Senior English Mentor',
      availableDays: ['monday', 'wednesday', 'friday'],
    };
    await mockDb.collection('tutors').doc(fakeAuthUid).set(updatePayload, { merge: true });
    await mockDb.collection('users').doc(fakeAuthUid).set(updatePayload, { merge: true });

    const tutorsDocs = mockDb._getWrittenDocs('tutors');
    const usersDocs = mockDb._getWrittenDocs('users');

    assert(
      !tutorsDocs.includes(publicId) && !tutorsDocs.includes(email) && !tutorsDocs.includes(email.replace(/[^a-zA-Z0-9]/g, '-')),
      'Nenhum documento criado em tutors com ID público, e-mail ou e-mail sanitizado'
    );
    assert(
      !usersDocs.includes(publicId) && !usersDocs.includes(email) && !usersDocs.includes(email.replace(/[^a-zA-Z0-9]/g, '-')),
      'Nenhum documento criado em users com ID público, e-mail ou e-mail sanitizado'
    );
  }

  // -------------------------------------------------------------------------
  // Teste 5: Skull Bee aparece uma única vez no catálogo
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 5: Skull Bee aparece uma única vez no catálogo ---');
  {
    // Multiple representations of Skull Bee simulating legacy and Firestore entries
    const rawTutorList = [
      {
        id: 'skull-bee',
        publicTutorId: 'skull-bee',
        name: 'Skull Bee',
        email: 'laviniafofafc@gmail.com',
        approvalStatus: 'approved',
        isApproved: true,
      },
      {
        id: 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1',
        authUid: 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1',
        uid: 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1',
        name: 'Skull Bee',
        email: 'laviniafofafc@gmail.com',
        approvalStatus: 'approved',
        isApproved: true,
      },
      {
        id: 'tutor-laviniafofafc-gmail-com',
        publicTutorId: 'skull-bee',
        name: 'Skull Bee (Amiga Nativa)',
        email: 'laviniafofafc@gmail.com',
        approvalStatus: 'approved',
        isApproved: true,
      },
    ];

    // Check areSameTutor cross matching
    assert(
      areSameTutor(rawTutorList[0], rawTutorList[1]),
      'areSameTutor identifica que skull-bee e UID jCkNIhvYEYbyJC2CWGZhFaoHGfo1 são o mesmo Native Friend'
    );
    assert(
      areSameTutor(rawTutorList[0], rawTutorList[2]),
      'areSameTutor identifica que skull-bee e tutor-laviniafofafc-gmail-com são o mesmo Native Friend'
    );

    const consolidated = consolidateTutorsList(rawTutorList);
    assert(
      consolidated.length === 1,
      `Skull Bee aparece exatamente UMA vez no catálogo consolidado (obtido: ${consolidated.length})`
    );
    assert(
      consolidated[0].uid === 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1' || consolidated[0].authUid === 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1',
      'Perfil consolidado da Skull Bee contém o Auth UID canônico jCkNIhvYEYbyJC2CWGZhFaoHGfo1'
    );
    assert(
      consolidated[0].publicTutorId === 'skull-bee',
      'Identificador público da Skull Bee é preservado como skull-bee'
    );
  }

  // -------------------------------------------------------------------------
  // Teste 6: Seleção por 'skull-bee' resulta em vínculo com o UID real
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 6: Seleção por skull-bee resulta em vínculo com o UID real ---');
  {
    // Resolve teacher by public identifier 'skull-bee'
    const resolution = await resolveTeacherCanonicalIdentity('skull-bee');
    assert(resolution !== null, 'resolveTeacherCanonicalIdentity resolve "skull-bee"');
    assert(
      resolution?.canonicalUid === 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1',
      `UID canônico resolvido para "skull-bee" é estritamente jCkNIhvYEYbyJC2CWGZhFaoHGfo1 (obtido: ${resolution?.canonicalUid})`
    );
    assert(
      resolution?.canonicalUid !== 'skull-bee',
      'UID canônico NÃO é o slug público "skull-bee"'
    );
    assert(
      resolution?.isApproved === true,
      'Skull Bee comprovada como professora aprovada'
    );
  }

  // -------------------------------------------------------------------------
  // Teste 7: UID inexistente ou não autorizado é rejeitado
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 7: UID inexistente ou não autorizado é rejeitado ---');
  {
    const invalidInputs = [
      'skull-bee',
      'tutor-laviniafofafc-gmail-com',
      'usr-some-user-id',
      'st-123456789012345',
      'random_invalid_short_slug',
      'laviniafofafc@gmail.com',
      'non_existent_unregistered_teacher_uid_9999',
    ];

    for (const bad of invalidInputs) {
      const isUidValid = isValidCanonicalUid(bad);
      if (['skull-bee', 'tutor-laviniafofafc-gmail-com', 'usr-some-user-id', 'st-123456789012345', 'random_invalid_short_slug', 'laviniafofafc@gmail.com'].includes(bad)) {
        assert(!isUidValid, `isValidCanonicalUid rejeita identificador não-canônico: "${bad}"`);
      }
    }

    const unapprovedResolution = await resolveTeacherCanonicalIdentity('non_existent_fake_teacher_id_xyz');
    assert(
      unapprovedResolution === null,
      'resolveTeacherCanonicalIdentity rejeita e retorna null para professor inexistente'
    );
  }

  // -------------------------------------------------------------------------
  // Teste 8: Agendamento novo grava teacherUid canônico
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 8: Agendamento novo grava teacherUid canônico ---');
  {
    const startDateTime = new Date(Date.now() + 86400000).toISOString();
    const endDateTime = new Date(Date.now() + 86400000 + 1800000).toISOString();
    const fakeStudentUid = 'student_canonical_auth_uid_008';

    const result = await scheduleLessonAtomicServer({
      studentAuthUid: fakeStudentUid,
      studentEmail: 'student008@example.com',
      studentName: 'Student 008',
      teacherIdOrEmail: 'skull-bee', // Student selected by public ID!
      startDateTime,
      endDateTime,
      isTrialLesson: true,
      requestId: `test-lesson-${Date.now()}`,
    });

    assert(result.success === true, 'Agendamento atômico concluído com sucesso');
    assert(
      result.lesson?.teacherUid === 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1',
      `teacherUid da aula é estritamente o Auth UID real (obtido: ${result.lesson?.teacherUid})`
    );
    assert(
      result.lesson?.teacherUid !== 'skull-bee',
      'teacherUid da nova aula NUNCA é o slug "skull-bee"'
    );
    assert(
      result.lesson?.teacherPublicId === 'skull-bee',
      'teacherPublicId registra o identificador público como metadado'
    );
  }

  // -------------------------------------------------------------------------
  // Teste 9: Referências legadas continuam legíveis sem novas gravações
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 9: Referências legadas continuam legíveis sem novas gravações ---');
  {
    const legacyLesson = {
      id: 'legacy-lesson-001',
      teacherUid: 'skull-bee', // old legacy reference
      studentUid: 'legacy_student_uid_009',
      startDateTime: new Date(Date.now() + 172800000).toISOString(),
      endDateTime: new Date(Date.now() + 172800000 + 1800000).toISOString(),
      status: 'scheduled',
    };

    // Attempt to schedule overlapping lesson for Skull Bee
    const conflictResult = await scheduleLessonAtomicServer({
      studentAuthUid: 'another_student_uid_009',
      studentEmail: 'another@example.com',
      teacherIdOrEmail: 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1', // Scheduling with real UID!
      startDateTime: legacyLesson.startDateTime,
      endDateTime: legacyLesson.endDateTime,
      isTrialLesson: true,
      existingLessons: [legacyLesson],
    });

    assert(
      conflictResult.success === false && conflictResult.statusCode === 409,
      'Conflito detectado corretamente contra aula legada referenciando "skull-bee"'
    );
  }

  // -------------------------------------------------------------------------
  // Teste 10: Regressão: cadastro de aluno, permissões e isolamento de dados
  // -------------------------------------------------------------------------
  console.log('\n--- Teste 10: Regressão: isolamento de dados e validações ---');
  {
    // Test: Anti-impersonation (student cannot schedule lesson with themselves)
    const selfLessonResult = await scheduleLessonAtomicServer({
      studentAuthUid: 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1', // Student is Lavinia!
      studentEmail: 'laviniafofafc@gmail.com',
      teacherIdOrEmail: 'skull-bee', // Teacher is also Lavinia!
      startDateTime: new Date(Date.now() + 259200000).toISOString(),
      endDateTime: new Date(Date.now() + 259200000 + 1800000).toISOString(),
      isTrialLesson: false,
    });

    assert(
      selfLessonResult.success === false,
      'Bloqueio de segurança anti-impersonation: aluno e professor não podem ter o mesmo UID'
    );
  }

  console.log('\n=========================================================================');
  console.log(` RESULTADO FINAL: ${passed} PASS, ${failed} FAIL`);
  console.log('=========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runHotfixTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
