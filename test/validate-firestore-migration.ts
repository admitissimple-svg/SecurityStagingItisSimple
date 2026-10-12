import {
  getFirestoreDb,
  getDefaultFirestoreDb,
  getAllServerFirestoreDbs,
  setFirebaseAdminFirestoreForTesting,
  resetFirebaseAdminFirestoreForTesting,
  saveTutorToFirestore,
  fetchTutorsFromFirestore,
  deleteTutorFromFirestore,
  deleteUserByEmailFromFirestore,
  saveUserToFirestore,
  fetchUserFromFirestore,
  fetchUsersFromFirestore,
  checkUserExistsInFirestore,
  fetchUserDocumentFromFirestore,
  fetchTutorDocumentFromFirestore,
  saveStudentAssignmentsByUid,
  fetchStudentAssignmentsByUid,
  saveTeacherAvailabilityToFirestore,
  fetchTeacherAvailabilityFromFirestore,
  saveRoutineVideoSubcollection,
  resetRepeatFlagsSubcollection,
  addWatchedVideoToUserDoc,
  saveStudentVocabularyToFirestoreServer,
  saveSessionNotesToFirestoreServer,
  fetchSessionNotesFromFirestoreServer,
  saveSessionNotesProgressToFirestore,
  saveStudentJournalToFirestore,
  fetchWeeklyChecksFromFirestore,
  saveWeeklyChecksToFirestore,
  fetchHomeworkFromFirestore,
  saveHomeworkToFirestore,
  saveAppStateToFirestore,
  fetchAppStateFromFirestore,
  saveYouTubePlaylistsToFirestore,
  fetchYouTubePlaylistsFromFirestore,
  ACTIVE_FIREBASE_PROJECT_ID,
  ACTIVE_FIREBASE_DATABASE_ID,
  ACTIVE_FIRESTORE_DATABASE_ID,
} from '../src/serverFirestore';
import {
  ALLOWED_STAGING_PROJECT_ID,
  resetFirebaseAdminForTesting,
  setFirebaseAdminAppForTesting,
} from '../src/serverFirebaseAdmin';
import type { Firestore } from 'firebase-admin/firestore';
import type { App } from 'firebase-admin/app';

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
 * High-fidelity in-memory Mock Firestore implementation for testing.
 * Strictly simulates Firebase Admin Firestore without performing any network or real cloud writes.
 */
class MockAdminFirestore {
  public projectId: string = ALLOWED_STAGING_PROJECT_ID;
  public databaseId: string = '(default)';
  public store: Map<string, any> = new Map();
  public simulateFailure: boolean = false;
  public failureError: Error = new Error('Firestore simulated permission denied');

  private getDocKey(collectionPath: string, docId: string): string {
    return `${collectionPath}::${docId}`;
  }

  public collection(collectionName: string) {
    const self = this;
    return {
      doc(docId: string) {
        return self.createDocRef(collectionName, docId);
      },
      where(field: string, op: string, value: any) {
        return {
          async get() {
            if (self.simulateFailure) throw self.failureError;
            const prefix = `${collectionName}::`;
            const matchingDocs: any[] = [];
            for (const [key, data] of self.store.entries()) {
              if (key.startsWith(prefix)) {
                const id = key.slice(prefix.length);
                if (op === '==' && data && data[field] === value) {
                  matchingDocs.push({
                    id,
                    exists: true,
                    data: () => JSON.parse(JSON.stringify(data)),
                  });
                }
              }
            }
            return {
              empty: matchingDocs.length === 0,
              size: matchingDocs.length,
              docs: matchingDocs,
              forEach(cb: (d: any) => void) {
                matchingDocs.forEach(cb);
              },
            };
          },
        };
      },
      async get() {
        if (self.simulateFailure) throw self.failureError;
        const prefix = `${collectionName}::`;
        const matchingDocs: any[] = [];
        for (const [key, data] of self.store.entries()) {
          if (key.startsWith(prefix)) {
            const id = key.slice(prefix.length);
            matchingDocs.push({
              id,
              exists: true,
              data: () => JSON.parse(JSON.stringify(data)),
              ref: self.createDocRef(collectionName, id),
            });
          }
        }
        return {
          empty: matchingDocs.length === 0,
          size: matchingDocs.length,
          docs: matchingDocs,
          forEach(cb: (d: any) => void) {
            matchingDocs.forEach(cb);
          },
        };
      },
    };
  }

  public createDocRef(colPath: string, docId: string): any {
    const self = this;
    const docKey = self.getDocKey(colPath, docId);
    return {
      id: docId,
      path: `${colPath}/${docId}`,
      collection(subColName: string) {
        const subColPath = `${colPath}/${docId}/${subColName}`;
        return {
          doc(subDocId: string) {
            return self.createDocRef(subColPath, subDocId);
          },
          async get() {
            if (self.simulateFailure) throw self.failureError;
            const prefix = `${subColPath}::`;
            const docs: any[] = [];
            for (const [key, data] of self.store.entries()) {
              if (key.startsWith(prefix)) {
                docs.push({
                  id: key.slice(prefix.length),
                  exists: true,
                  data: () => JSON.parse(JSON.stringify(data)),
                });
              }
            }
            return {
              empty: docs.length === 0,
              size: docs.length,
              docs,
              forEach(cb: (d: any) => void) {
                docs.forEach(cb);
              },
            };
          },
        };
      },
      async get() {
        if (self.simulateFailure) throw self.failureError;
        const data = self.store.get(docKey);
        const exists = data !== undefined;
        return {
          id: docId,
          exists,
          data: () => (exists ? JSON.parse(JSON.stringify(data)) : undefined),
        };
      },
      async set(newData: any, options?: { merge?: boolean }) {
        if (self.simulateFailure) throw self.failureError;
        const current = self.store.get(docKey);
        if (options?.merge && current) {
          self.store.set(docKey, { ...current, ...JSON.parse(JSON.stringify(newData)) });
        } else {
          self.store.set(docKey, JSON.parse(JSON.stringify(newData)));
        }
        return { writeTime: new Date().toISOString() };
      },
      async delete() {
        if (self.simulateFailure) throw self.failureError;
        self.store.delete(docKey);
        return { writeTime: new Date().toISOString() };
      },
    };
  }

  public batch() {
    const operations: Array<() => void> = [];
    const self = this;
    return {
      set(docRef: any, data: any, options?: { merge?: boolean }) {
        operations.push(() => {
          docRef.set(data, options);
        });
        return this;
      },
      delete(docRef: any) {
        operations.push(() => {
          docRef.delete();
        });
        return this;
      },
      async commit() {
        if (self.simulateFailure) throw self.failureError;
        for (const op of operations) {
          op();
        }
        return [];
      },
    };
  }
}

// Preserve original env vars
const originalFirebaseProjectId = process.env.FIREBASE_PROJECT_ID;

function restoreEnv() {
  if (originalFirebaseProjectId !== undefined) {
    process.env.FIREBASE_PROJECT_ID = originalFirebaseProjectId;
  } else {
    delete process.env.FIREBASE_PROJECT_ID;
  }
}

async function runTestSuite() {
  console.log('\n=== INICIANDO BATERIA DE TESTES: ETAPA 3B (Migração Controlada do Backend Firestore) ===\n');

  try {
    // -------------------------------------------------------------------------
    // Cenário 1: Inicialização no projeto correto e recusa do projeto antigo
    // -------------------------------------------------------------------------
    console.log('--- 1. Inicialização no projeto correto (itissimple-security-staging) e bloqueio do projeto antigo ---');
    {
      resetFirebaseAdminFirestoreForTesting();
      resetFirebaseAdminForTesting();

      assert(ACTIVE_FIREBASE_PROJECT_ID === ALLOWED_STAGING_PROJECT_ID, 'ACTIVE_FIREBASE_PROJECT_ID é itissimple-security-staging');
      assert(ACTIVE_FIREBASE_DATABASE_ID === '(default)', 'ACTIVE_FIREBASE_DATABASE_ID é exclusivamente (default)');
      assert(ACTIVE_FIRESTORE_DATABASE_ID === '(default)', 'ACTIVE_FIRESTORE_DATABASE_ID é exclusivamente (default)');

      // Mock App configurado com staging autorizado
      const mockStagingApp: any = {
        name: '[DEFAULT]',
        options: { projectId: ALLOWED_STAGING_PROJECT_ID },
      };
      setFirebaseAdminAppForTesting(mockStagingApp as App);

      const mockFirestore = new MockAdminFirestore() as unknown as Firestore;
      setFirebaseAdminFirestoreForTesting(mockFirestore);

      const db = getFirestoreDb();
      assert(db !== null, 'getFirestoreDb() retorna instância mock válida');
      assert((db as any).projectId === ALLOWED_STAGING_PROJECT_ID, 'Instância pertence estritamente ao projeto itissimple-security-staging');
      assert((db as any).databaseId === '(default)', 'Instância utiliza exclusivamente banco (default)');

      // Tentativa de reutilizar Firestore de projeto antigo itissimple-8663d
      const legacyMockFirestore: any = {
        projectId: 'itissimple-8663d',
        databaseId: '(default)',
      };
      setFirebaseAdminFirestoreForTesting(legacyMockFirestore);

      let blockedLegacy = false;
      try {
        getFirestoreDb();
      } catch (err: any) {
        blockedLegacy = err.message.includes('Unauthorized Firestore instance');
      }
      assert(blockedLegacy, 'getFirestoreDb() bloqueia estritamente instância associada ao projeto antigo itissimple-8663d');

      // Tentativa de inicializar com App do projeto antigo
      resetFirebaseAdminFirestoreForTesting();
      const legacyApp: any = {
        name: '[DEFAULT]',
        options: { projectId: 'itissimple-8663d' },
      };
      setFirebaseAdminAppForTesting(legacyApp as App);

      const legacyDbResult = getFirestoreDb();
      assert(legacyDbResult === null, 'getFirestoreDb() recusa criar Firestore client se o App pertencer ao projeto antigo e retorna null');
    }

    // -------------------------------------------------------------------------
    // Cenário 2: Leitura e gravação de perfis de alunos e usuários
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Leitura e gravação de perfis de alunos e usuários ---');
    {
      const mockDb = new MockAdminFirestore();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);

      // Salvar usuário com UID válido
      const sampleStudent = {
        uid: 'user-staging-101',
        email: 'student.staging@itissimple.com',
        name: 'Carlos Aluno',
        role: 'student',
        level: 'intermediario',
        createdAt: '2026-10-09T00:00:00.000Z',
      };

      const saved = await saveUserToFirestore(sampleStudent);
      assert(saved === true, 'saveUserToFirestore retorna true');

      const storedUser = mockDb.store.get('users::user-staging-101');
      assert(storedUser !== undefined, 'Documento gravado no caminho users/user-staging-101');
      assert(storedUser.email === 'student.staging@itissimple.com', 'E-mail do usuário persistido corretamente');
      assert(storedUser.role === 'student', 'Role student preservada');

      // Leitura de perfil por UID
      const fetchedByUid = await fetchUserFromFirestore('student.staging@itissimple.com', 'user-staging-101');
      assert(fetchedByUid !== null, 'fetchUserFromFirestore retorna usuário por UID');
      assert(fetchedByUid.name === 'Carlos Aluno', 'Nome do usuário corresponde');

      // Leitura de documento direto por helper
      const fetchedDirect = await fetchUserDocumentFromFirestore('user-staging-101');
      assert(fetchedDirect !== null, 'fetchUserDocumentFromFirestore recupera dados');
      assert(fetchedDirect.uid === 'user-staging-101', 'UID corresponde');

      // Listar todos os usuários
      const allUsers = await fetchUsersFromFirestore();
      assert(Array.isArray(allUsers) && allUsers.length === 1, 'fetchUsersFromFirestore retorna lista contendo o usuário');
      assert(allUsers[0].id === 'user-staging-101', 'ID do usuário no array corresponde');

      // Verificar existência de usuário
      const exists = await checkUserExistsInFirestore('student.staging@itissimple.com');
      assert(exists === true, 'checkUserExistsInFirestore retorna true para usuário existente');

      const nonExistent = await checkUserExistsInFirestore('ghost@itissimple.com');
      assert(nonExistent === false, 'checkUserExistsInFirestore retorna false para usuário inexistente');

      // Exclusão de usuário por e-mail (usado no DELETE /api/students/profile)
      const deleted = await deleteUserByEmailFromFirestore('student.staging@itissimple.com');
      assert(deleted === true, 'deleteUserByEmailFromFirestore retorna true');
      assert(mockDb.store.get('users::user-staging-101') === undefined, 'Documento foi removido do Firestore');
    }

    // -------------------------------------------------------------------------
    // Cenário 3: Cadastro, aprovação e exclusão de professores / Native Friends
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Cadastro, aprovação e persistência de professores ---');
    {
      const mockDb = new MockAdminFirestore();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);

      const sampleTutor = {
        id: 'tutor-sarah-jenkins',
        email: 'sarah.jenkins@itissimple.com',
        name: 'Sarah Jenkins',
        bio: 'Native English Speaker from UK',
        approvalStatus: 'pending',
        isApproved: false,
        hourlyRate: 35,
      };

      const savedTutor = await saveTutorToFirestore(sampleTutor);
      assert(savedTutor === true, 'saveTutorToFirestore retorna true para novo cadastro');

      // Verifica caminhos simultâneos: users/{id} e tutors/{id}
      const userDoc = mockDb.store.get('users::tutor-sarah-jenkins');
      const tutorDoc = mockDb.store.get('tutors::tutor-sarah-jenkins');
      assert(userDoc !== undefined && tutorDoc !== undefined, 'Tutor persistido simultaneamente em /users e /tutors');
      assert(userDoc.role === 'teacher', 'Role do professor é estritamente teacher');
      assert(tutorDoc.approvalStatus === 'pending', 'Status inicial é pending');

      // Aprovação do tutor
      const approvedTutor = {
        ...sampleTutor,
        approvalStatus: 'approved',
        isApproved: true,
      };
      const updateResult = await saveTutorToFirestore(approvedTutor);
      assert(updateResult === true, 'saveTutorToFirestore atualiza aprovação com sucesso');

      const updatedTutorDoc = mockDb.store.get('tutors::tutor-sarah-jenkins');
      assert(updatedTutorDoc.approvalStatus === 'approved', 'approvalStatus atualizado para approved');
      assert(updatedTutorDoc.isApproved === true, 'isApproved atualizado para true');

      // Leitura da lista de professores
      const tutorsList = await fetchTutorsFromFirestore();
      assert(tutorsList.length === 1, 'fetchTutorsFromFirestore retorna o professor aprovado');
      assert(tutorsList[0].email === 'sarah.jenkins@itissimple.com', 'E-mail do professor retornado corretamente');
      assert(tutorsList[0].role === 'teacher', 'Role preservada como teacher');

      // Leitura via helper fetchTutorDocumentFromFirestore
      const directTutor = await fetchTutorDocumentFromFirestore('tutor-sarah-jenkins');
      assert(directTutor !== null, 'fetchTutorDocumentFromFirestore recupera perfil');
      assert(directTutor.name === 'Sarah Jenkins', 'Nome do tutor validado');

      // Exclusão do tutor
      const tutorDeleted = await deleteTutorFromFirestore('tutor-sarah-jenkins');
      assert(tutorDeleted === true, 'deleteTutorFromFirestore retorna true');
      assert(mockDb.store.get('tutors::tutor-sarah-jenkins') === undefined, 'Perfil removido da coleção /tutors');
      assert(mockDb.store.get('users::tutor-sarah-jenkins') === undefined, 'Perfil removido da coleção /users');
    }

    // -------------------------------------------------------------------------
    // Cenário 4: Disponibilidade de professores (30-min slots e meetLink)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Disponibilidade de professores ---');
    {
      const mockDb = new MockAdminFirestore();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);

      const availabilityData = {
        uid: 'teacher-uid-500',
        teacherEmail: 'teacher.availability@itissimple.com',
        meetLink: 'https://meet.google.com/abc-defg-hij',
        timezone: 'America/Sao_Paulo',
        availableDays: ['monday', 'wednesday', 'friday'],
        availableHours: ['09:00', '09:30', '10:00', '14:00'],
      };

      const savedAvail = await saveTeacherAvailabilityToFirestore('teacher-uid-500', availabilityData);
      assert(savedAvail === true, 'saveTeacherAvailabilityToFirestore retorna true');

      const fetchedAvail = await fetchTeacherAvailabilityFromFirestore('teacher-uid-500');
      assert(fetchedAvail !== null, 'fetchTeacherAvailabilityFromFirestore recupera dados');
      assert(fetchedAvail.meetLink === 'https://meet.google.com/abc-defg-hij', 'Meet link persistido com integridade');
      assert(Array.isArray(fetchedAvail.availableDays) && fetchedAvail.availableDays.length === 3, 'Dias disponíveis íntegros');
    }

    // -------------------------------------------------------------------------
    // Cenário 5: Atribuições e vocabulário cumulativo de alunos
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Atribuições pedagógicas e vocabulário cumulativo ---');
    {
      const mockDb = new MockAdminFirestore();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);

      // Atribuições de mídias por UID
      const assignmentData = {
        uid: 'student-media-1',
        level: 'iniciante',
        weeklyCycle: 1,
        videoAssignments: [{ videoId: 'vid-001', title: 'Basic Greetings' }],
        spotifyAssignments: [{ trackId: 'trk-001', name: 'Everyday Dialogue' }],
      };

      const savedAssign = await saveStudentAssignmentsByUid('student-media-1', assignmentData);
      assert(savedAssign === true, 'saveStudentAssignmentsByUid retorna true');

      const fetchedAssign = await fetchStudentAssignmentsByUid('student-media-1');
      assert(fetchedAssign !== null, 'fetchStudentAssignmentsByUid recupera dados');
      assert(fetchedAssign.videoAssignments[0].videoId === 'vid-001', 'Atribuição de vídeo recuperada');

      // Vocabulário cumulativo
      const initialVocab = [
        { word: 'Apple', translation: 'Maçã', context: 'I eat an apple' },
      ];
      const savedVocab1 = await saveStudentVocabularyToFirestoreServer('student-media-1', initialVocab);
      assert(savedVocab1 === true, 'saveStudentVocabularyToFirestoreServer salva lote 1');

      const additionalVocab = [
        { word: 'Banana', translation: 'Banana', context: 'Monkeys like bananas' },
      ];
      const savedVocab2 = await saveStudentVocabularyToFirestoreServer('student-media-1', additionalVocab);
      assert(savedVocab2 === true, 'saveStudentVocabularyToFirestoreServer salva lote 2 cumulativo');

      // Verifica se o array acumulado na coleção users contém ambas as palavras
      const userDoc = mockDb.store.get('users::student-media-1');
      assert(userDoc !== undefined && Array.isArray(userDoc.vocabulary), 'Campo vocabulary existe no documento do usuário');
      assert(userDoc.vocabulary.length === 2, 'Vocabulário cumulativo possui exatamente 2 palavras');
      assert(userDoc.vocabulary[0].word.toLowerCase() === 'apple', 'Palavra 1 preservada');
      assert(userDoc.vocabulary[1].word.toLowerCase() === 'banana', 'Palavra 2 adicionada cumulativamente');

      // Subcoleção vocabulary/{wordId}
      const appleSubDoc = mockDb.store.get('users/student-media-1/vocabulary::apple');
      assert(appleSubDoc !== undefined, 'Subcoleção users/{uid}/vocabulary/apple persistida individualmente');
    }

    // -------------------------------------------------------------------------
    // Cenário 6: Rotinas diárias, repetições, vídeos assistidos e diário
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Rotinas diárias, histórico de vídeos e diário do estudante ---');
    {
      const mockDb = new MockAdminFirestore();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);

      // Subcoleção de rotina diária
      const routineVideo = {
        videoId: 'vid-wednesday-01',
        title: 'Wednesday Pronunciation Workout',
        isRepeatVideo: true,
      };
      const savedRoutine = await saveRoutineVideoSubcollection('student-media-1', 'wednesday', routineVideo);
      assert(savedRoutine === true, 'saveRoutineVideoSubcollection retorna true');

      const routineDoc = mockDb.store.get('users/student-media-1/routines::wednesday');
      assert(routineDoc !== undefined, 'Documento de rotina criado em users/{uid}/routines/wednesday');
      assert(routineDoc.isRepeatVideo === true, 'isRepeatVideo gravado como true');

      // Reset de flags de repetição
      const resetResult = await resetRepeatFlagsSubcollection('student-media-1');
      assert(resetResult === true, 'resetRepeatFlagsSubcollection retorna true');
      const resetRoutineDoc = mockDb.store.get('users/student-media-1/routines::wednesday');
      assert(resetRoutineDoc.isRepeatVideo === false, 'isRepeatVideo resetado para false com sucesso');

      // Histórico de vídeos assistidos
      const watched1 = await addWatchedVideoToUserDoc('student-media-1', 'vid-001', 'Intro to Sounds');
      assert(watched1 === true, 'addWatchedVideoToUserDoc adiciona novo vídeo assistido');

      const userAfterWatch = mockDb.store.get('users::student-media-1');
      assert(userAfterWatch.watchedVideosHistory.length === 1, 'Histórico contém 1 vídeo');

      // Adicionar vídeo duplicado não duplica no array
      await addWatchedVideoToUserDoc('student-media-1', 'vid-001', 'Intro to Sounds');
      const userAfterDup = mockDb.store.get('users::student-media-1');
      assert(userAfterDup.watchedVideosHistory.length === 1, 'Vídeo duplicado não é reinserido no histórico');

      // Diário do estudante (studentJournal)
      const journalEntries = [
        { id: 'j-01', text: 'Practiced speaking today', date: '2026-10-09' },
      ];
      const savedJournal = await saveStudentJournalToFirestore('student-media-1', journalEntries);
      assert(savedJournal === true, 'saveStudentJournalToFirestore retorna true');

      const userAfterJournal = mockDb.store.get('users::student-media-1');
      assert(Array.isArray(userAfterJournal.studentJournal), 'studentJournal gravado em users/{docId}');
      assert(userAfterJournal.studentJournal.length === 1, 'Entrada de diário confirmada');
    }

    // -------------------------------------------------------------------------
    // Cenário 7: Checagens semanais (Routine Checks) e Lições de Casa (Homework) isoladas por semana
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Checagens semanais e tarefas isoladas por semana ---');
    {
      const mockDb = new MockAdminFirestore();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);

      // Semana 1: grava na subcoleção weeklyChecks/week-1 e no root compatível
      const week1Checks = {
        'monday-video': true,
        'tuesday-audio': true,
      };
      const savedW1 = await saveWeeklyChecksToFirestore(
        'student-week-test',
        'week-1',
        { id: 'week-1', checks: week1Checks },
        { weeklyChecks: week1Checks }
      );
      assert(savedW1 === true, 'saveWeeklyChecksToFirestore semana 1 retorna true');

      const fetchedW1 = await fetchWeeklyChecksFromFirestore(['student-week-test'], 'week-1', 1);
      assert(fetchedW1 !== null, 'fetchWeeklyChecksFromFirestore recupera semana 1');
      assert(fetchedW1!['monday-video'] === true, 'Checagem de segunda-feira confirmada');

      // Semana 2: grava estritamente na subcoleção weeklyChecks/week-2
      const week2Checks = {
        'wednesday-fluency': true,
      };
      const savedW2 = await saveWeeklyChecksToFirestore(
        'student-week-test',
        'week-2',
        { id: 'week-2', checks: week2Checks },
        { updatedAt: new Date().toISOString() }
      );
      assert(savedW2 === true, 'saveWeeklyChecksToFirestore semana 2 retorna true');

      const fetchedW2 = await fetchWeeklyChecksFromFirestore(['student-week-test'], 'week-2', 2);
      assert(fetchedW2 !== null, 'fetchWeeklyChecksFromFirestore recupera semana 2');
      assert(fetchedW2!['wednesday-fluency'] === true, 'Checagem de semana 2 confirmada');

      // Homework semana 1 e semana 2
      const hwWeek1 = {
        weekId: 'week-1',
        completedPartsByDay: { monday: ['matching'] },
      };
      const savedHw1 = await saveHomeworkToFirestore('student-week-test', 'week-1', 1, hwWeek1);
      assert(savedHw1 === true, 'saveHomeworkToFirestore semana 1 retorna true');

      const fetchedHw1 = await fetchHomeworkFromFirestore(['student-week-test'], 'week-1', 1);
      assert(fetchedHw1 !== null, 'fetchHomeworkFromFirestore recupera tarefa semana 1');
      assert(fetchedHw1.completedPartsByDay.monday[0] === 'matching', 'Conteúdo da tarefa semana 1 íntegro');

      const hwWeek2 = {
        weekId: 'week-2',
        completedPartsByDay: { tuesday: ['sentences'] },
      };
      const savedHw2 = await saveHomeworkToFirestore('student-week-test', 'week-2', 2, hwWeek2);
      assert(savedHw2 === true, 'saveHomeworkToFirestore semana 2 retorna true');

      const fetchedHw2 = await fetchHomeworkFromFirestore(['student-week-test'], 'week-2', 2);
      assert(fetchedHw2 !== null, 'fetchHomeworkFromFirestore recupera tarefa semana 2');
      assert(fetchedHw2.completedPartsByDay.tuesday[0] === 'sentences', 'Conteúdo da tarefa semana 2 íntegro');
    }

    // -------------------------------------------------------------------------
    // Cenário 8: Notas de sessão de Native Friends e progresso de revisão
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Notas de sessão e progresso de revisão ---');
    {
      const mockDb = new MockAdminFirestore();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);

      const sessionNotes = {
        sessionDate: '2026-10-09',
        studentEmail: 'student@itissimple.com',
        studentUid: 'usr-student-001',
        teacherName: 'John Native Friend',
        topic: 'Travel & Airport Vocabulary',
        content: 'Focused on boarding questions and customs procedures.',
        lessonId: 'lesson-rec-001',
      };

      const savedNotes = await saveSessionNotesToFirestoreServer('2026-10-09-session-1', sessionNotes);
      assert(savedNotes === true, 'saveSessionNotesToFirestoreServer retorna true');

      const fetchedNotes = await fetchSessionNotesFromFirestoreServer('2026-10-09-session-1');
      assert(fetchedNotes !== null, 'fetchSessionNotesFromFirestoreServer recupera notas');
      assert(fetchedNotes.topic === 'Travel & Airport Vocabulary', 'Tópico de sessão recuperado com integridade');

      // Progresso do ciclo de revisão
      const progressPayload = {
        studentUid: 'usr-student-001',
        studentEmail: 'student@itissimple.com',
        lastSessionKey: '2026-10-09-session-1',
        stepIndex: 3,
        lastReviewedTab: 'vocabulary',
      };
      const savedProg = await saveSessionNotesProgressToFirestore('usr-student-001', progressPayload);
      assert(savedProg === true, 'saveSessionNotesProgressToFirestore retorna true');

      const userAfterProg = mockDb.store.get('users::usr-student-001');
      assert(userAfterProg.nativeNotesReview.stepIndex === 3, 'Progresso de revisão persistido no usuário');
    }

    // -------------------------------------------------------------------------
    // Cenário 9: Estado global modular da aplicação (app_state) e Playlists YouTube
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Persistência modular de app_state e YouTube playlists ---');
    {
      const mockDb = new MockAdminFirestore();
      setFirebaseAdminFirestoreForTesting(mockDb as unknown as Firestore);

      // Playlists YouTube
      const samplePlaylists = [
        { id: 'pl-01', level: 'iniciante', playlistId: 'PL123456789' },
      ];
      const savedPlaylists = await saveYouTubePlaylistsToFirestore(samplePlaylists);
      assert(savedPlaylists === true, 'saveYouTubePlaylistsToFirestore retorna true');

      const fetchedPlaylists = await fetchYouTubePlaylistsFromFirestore();
      assert(Array.isArray(fetchedPlaylists) && fetchedPlaylists.length === 1, 'fetchYouTubePlaylistsFromFirestore recupera playlists');
      assert(fetchedPlaylists![0].playlistId === 'PL123456789', 'Playlist ID recuperado com integridade');

      // app_state modular
      const appData = {
        userProfiles: {
          'test@itissimple.com': { name: 'Test User', email: 'test@itissimple.com' },
        },
        tutorsList: [
          { id: 'tutor-01', name: 'Tutor One', email: 'tutor1@itissimple.com' },
        ],
        liveLessons: [
          { id: 'lesson-01', title: 'Live Session 1' },
        ],
      };

      const savedState = await saveAppStateToFirestore(appData);
      assert(savedState === true, 'saveAppStateToFirestore particiona e grava com sucesso');

      assert(mockDb.store.get('app_state::main_data') !== undefined, 'app_state/main_data particionado');
      assert(mockDb.store.get('app_state::tutors') !== undefined, 'app_state/tutors particionado');
      assert(mockDb.store.get('app_state::lessons') !== undefined, 'app_state/lessons particionado');

      const fetchedState = await fetchAppStateFromFirestore();
      assert(fetchedState !== null, 'fetchAppStateFromFirestore reidrata estado completo');
      assert(fetchedState.userProfiles['test@itissimple.com'].name === 'Test User', 'userProfiles reidratado');
    }

    // -------------------------------------------------------------------------
    // Cenário 10: Tratamento de falhas de conexão, permissões e ausência de dados
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Resiliência a falhas de conexão e permissões (diferenciação explícita) ---');
    {
      const failingMockDb = new MockAdminFirestore();
      failingMockDb.simulateFailure = true;
      failingMockDb.failureError = new Error('PERMISSION_DENIED: The caller does not have permission');
      setFirebaseAdminFirestoreForTesting(failingMockDb as unknown as Firestore);

      // Tentativas de gravação com falha no banco
      const userSaveFailed = await saveUserToFirestore({ uid: 'usr-err', email: 'err@itissimple.com' });
      assert(userSaveFailed === false, 'saveUserToFirestore retorna false quando o banco falha (sem mascarar como sucesso)');

      const tutorSaveFailed = await saveTutorToFirestore({ id: 'tutor-err', email: 'err@itissimple.com' });
      assert(tutorSaveFailed === false, 'saveTutorToFirestore retorna false quando o banco falha');

      const appStateFailed = await saveAppStateToFirestore({ liveLessons: [] });
      assert(appStateFailed === false, 'saveAppStateToFirestore retorna false quando o banco falha');

      // Tentativas de leitura com falha no banco
      const userReadFailed = await fetchUserFromFirestore('err@itissimple.com', 'usr-err');
      assert(userReadFailed === null, 'fetchUserFromFirestore retorna null com falha de conexão');

      const tutorsReadFailed = await fetchTutorsFromFirestore();
      assert(Array.isArray(tutorsReadFailed) && tutorsReadFailed.length === 0, 'fetchTutorsFromFirestore retorna array vazio sem lançar erro não capturado');

      // Ausência de alterações indevidas no store em caso de falha
      assert(failingMockDb.store.size === 0, 'Nenhum dado é gravado no store após falhas');
    }

    // -------------------------------------------------------------------------
    // Cenário 11: getFirestoreDb nulo quando app não inicializado
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Comportamento gracioso quando Firestore não está disponível ---');
    {
      setFirebaseAdminFirestoreForTesting(null);
      resetFirebaseAdminForTesting();

      // Sem FIREBASE_PROJECT_ID
      delete process.env.FIREBASE_PROJECT_ID;

      const db = getFirestoreDb();
      assert(db === null, 'getFirestoreDb() retorna null graciosamente quando app não pode inicializar');

      const allDbs = getAllServerFirestoreDbs();
      assert(Array.isArray(allDbs) && allDbs.length === 0, 'getAllServerFirestoreDbs() retorna array vazio');

      const defDb = getDefaultFirestoreDb();
      assert(defDb === null, 'getDefaultFirestoreDb() retorna null');

      // Operações com db nulo
      const userRes = await saveUserToFirestore({ uid: 'u1', email: 'u1@test.com' });
      assert(userRes === false, 'saveUserToFirestore retorna false quando db é null');

      const tutorRes = await fetchTutorsFromFirestore();
      assert(Array.isArray(tutorRes) && tutorRes.length === 0, 'fetchTutorsFromFirestore retorna [] quando db é null');
    }
  } finally {
    restoreEnv();
    resetFirebaseAdminFirestoreForTesting();
    resetFirebaseAdminForTesting();
  }

  console.log('\n========================================');
  console.log(`TOTAL DE TESTES FIRESTORE MIGRATION: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
