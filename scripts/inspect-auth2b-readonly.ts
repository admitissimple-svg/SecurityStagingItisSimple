import { getFirebaseAdminApp, getFirebaseAdminAuth, ALLOWED_STAGING_PROJECT_ID } from '../src/serverFirebaseAdmin';
import { getFirestore } from 'firebase-admin/firestore';
import appletConfig from '../firebase-applet-config.json' with { type: 'json' };

process.env.FIREBASE_PROJECT_ID = ALLOWED_STAGING_PROJECT_ID;

async function run() {
  console.log('=== AUTH.2B READ-ONLY INVESTIGATION ===');
  console.log('Target Project:', ALLOWED_STAGING_PROJECT_ID);
  console.log('Applet Config Database:', appletConfig.firestoreDatabaseId);

  let adminAuth: any = null;
  try {
    const app = getFirebaseAdminApp();
    adminAuth = getFirebaseAdminAuth();
    console.log('Firebase Admin initialized successfully.');
  } catch (err: any) {
    console.error('Failed to init Firebase Admin:', err.message);
    return;
  }

  // 1. Check Auth for reginahelena1980@gmail.com
  console.log('\n--- 1. Firebase Auth Check: reginahelena1980@gmail.com ---');
  try {
    const regina = await adminAuth.getUserByEmail('reginahelena1980@gmail.com');
    console.log('Found reginahelena1980@gmail.com:');
    console.log('  UID:', regina.uid);
    console.log('  Email:', regina.email);
    console.log('  EmailVerified:', regina.emailVerified);
    console.log('  DisplayName:', regina.displayName);
    console.log('  CustomClaims:', regina.customClaims);
    console.log('  Disabled:', regina.disabled);
    console.log('  Metadata:', regina.metadata);
  } catch (err: any) {
    console.log('Error fetching reginahelena1980@gmail.com:', err.message);
  }

  // 2. Search for any user with "carla" in Auth
  console.log('\n--- 2. Firebase Auth Check: Searching for "carla" or listing users ---');
  try {
    const listRes = await adminAuth.listUsers(100);
    console.log(`Total users in Firebase Auth (up to 100): ${listRes.users.length}`);
    for (const u of listRes.users) {
      const email = u.email || '';
      const name = u.displayName || '';
      console.log(`  User: UID=${u.uid} | Email=${email} | Name=${name} | Claims=${JSON.stringify(u.customClaims)}`);
    }
  } catch (err: any) {
    console.log('Error listing users from Auth:', err.message);
  }

  // 3. Inspect Firestore for both databases: '(default)' and appletConfig.firestoreDatabaseId
  const dbIds = ['(default)', appletConfig.firestoreDatabaseId];
  for (const dbId of dbIds) {
    console.log(`\n--- 3. Firestore Inspection for Database: "${dbId}" ---`);
    try {
      const app = getFirebaseAdminApp();
      const db = getFirestore(app, dbId);

      // Check users collection
      console.log(`[${dbId}] Checking /users collection...`);
      try {
        const usersSnap = await db.collection('users').get();
        console.log(`[${dbId}] Total /users docs: ${usersSnap.size}`);
        for (const doc of usersSnap.docs) {
          const d = doc.data();
          console.log(`  Doc ID: ${doc.id}`);
          console.log(`    Data:`, JSON.stringify(d, null, 2));
        }
      } catch (err: any) {
        console.log(`[${dbId}] Error querying /users:`, err.message);
      }

      // Check tutors collection
      console.log(`[${dbId}] Checking /tutors collection...`);
      try {
        const tutorsSnap = await db.collection('tutors').get();
        console.log(`[${dbId}] Total /tutors docs: ${tutorsSnap.size}`);
        for (const doc of tutorsSnap.docs) {
          const d = doc.data();
          console.log(`  Doc ID: ${doc.id}`);
          console.log(`    Data:`, JSON.stringify(d, null, 2));
        }
      } catch (err: any) {
        console.log(`[${dbId}] Error querying /tutors:`, err.message);
      }

      // Check specific docs for regina
      console.log(`[${dbId}] Querying /users by email 'reginahelena1980@gmail.com'...`);
      try {
        const qEm = await db.collection('users').where('email', '==', 'reginahelena1980@gmail.com').get();
        console.log(`[${dbId}] Matches in /users: ${qEm.size}`);
        for (const doc of qEm.docs) {
          console.log(`    Doc ID: ${doc.id} =>`, JSON.stringify(doc.data(), null, 2));
        }
      } catch (err: any) {
        console.log(`[${dbId}] Error querying /users by email:`, err.message);
      }

      try {
        const qTutorEm = await db.collection('tutors').where('email', '==', 'reginahelena1980@gmail.com').get();
        console.log(`[${dbId}] Matches in /tutors: ${qTutorEm.size}`);
        for (const doc of qTutorEm.docs) {
          console.log(`    Doc ID: ${doc.id} =>`, JSON.stringify(doc.data(), null, 2));
        }
      } catch (err: any) {
        console.log(`[${dbId}] Error querying /tutors by email:`, err.message);
      }

    } catch (err: any) {
      console.log(`[${dbId}] Failed to access Firestore:`, err.message);
    }
  }

  console.log('\n=== INVESTIGATION COMPLETED ===');
}

run().catch(console.error);
