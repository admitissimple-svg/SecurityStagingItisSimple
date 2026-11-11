import { getFirebaseAdminApp, ALLOWED_STAGING_PROJECT_ID } from '../src/serverFirebaseAdmin';
import { getFirestore } from 'firebase-admin/firestore';
import { parseNotesHtml } from '../src/utils/notesHtmlParser';
import { computeNotesHash } from '../src/utils/pedagogicalTransformer';

process.env.FIREBASE_PROJECT_ID = ALLOWED_STAGING_PROJECT_ID;

async function run() {
  console.log('=== NF-NOTES.9 READ-ONLY AUDIT: 11/11/2026 CHARLES LAMBERT ===');
  const app = getFirebaseAdminApp();
  const db = getFirestore(app, '(default)');

  // 1. Search in 'liveLessons' and 'lessons' for 2026-11-11 or teacher Charles
  console.log('\n--- 1. Searching Lessons ---');
  const liveLessonsSnap = await db.collection('liveLessons').get();
  console.log(`Total liveLessons docs in (default): ${liveLessonsSnap.size}`);
  for (const doc of liveLessonsSnap.docs) {
    const data = doc.data();
    const isNov11 = String(data.date || data.sessionDate || data.scheduledAt || data.startDateTime || '').includes('2026-11-11');
    const isCharles = String(data.teacherName || data.tutorName || '').toLowerCase().includes('charles');
    const hasNotes = Boolean(data.sessionNotes || data.notes || data.rawNotes);
    if (isNov11 || isCharles || hasNotes) {
      console.log(`[liveLessons] Doc ID: ${doc.id}`);
      console.log(`  date: ${data.date || data.sessionDate || data.scheduledAt || data.startDateTime}`);
      console.log(`  teacherName: ${data.teacherName || data.tutorName}`);
      console.log(`  studentUid: ${data.studentUid ? data.studentUid.slice(0, 8) + '...' : 'none'}`);
      console.log(`  status: ${data.status}`);
      console.log(`  type: ${data.type}`);
      if (data.sessionNotes || data.notes) {
        console.log(`  has sessionNotes (length: ${String(data.sessionNotes || data.notes).length})`);
      }
    }
  }

  const lessonsSnap = await db.collection('lessons').get();
  console.log(`Total lessons docs in (default): ${lessonsSnap.size}`);
  for (const doc of lessonsSnap.docs) {
    const data = doc.data();
    const isNov11 = String(data.date || data.sessionDate || data.scheduledAt || data.startDateTime || '').includes('2026-11-11');
    const isCharles = String(data.teacherName || data.tutorName || '').toLowerCase().includes('charles');
    if (isNov11 || isCharles) {
      console.log(`[lessons] Doc ID: ${doc.id}`);
      console.log(`  date: ${data.date || data.sessionDate || data.scheduledAt || data.startDateTime}`);
      console.log(`  teacherName: ${data.teacherName || data.tutorName}`);
      console.log(`  studentUid: ${data.studentUid ? data.studentUid.slice(0, 8) + '...' : 'none'}`);
    }
  }

  // 2. Search in 'session_notes'
  console.log('\n--- 2. Searching session_notes ---');
  const sessionNotesSnap = await db.collection('session_notes').get();
  console.log(`Total session_notes docs in (default): ${sessionNotesSnap.size}`);
  let targetSessionKey = '';
  let targetRawNotes = '';
  for (const doc of sessionNotesSnap.docs) {
    const data = doc.data();
    const id = doc.id;
    const isNov11 = id.includes('2026-11-11') || String(data.date || data.sessionDate || '').includes('2026-11-11');
    const isCharles = String(data.teacherName || '').toLowerCase().includes('charles');
    const content = String(data.rawContent || data.rawNotes || data.content || data.html || '');
    const hasCan = content.includes("can't to have") || content.includes("can&#39;t to have") || content.includes("can&apos;t to have") || content.includes("can't");
    
    console.log(`[session_notes] ID: ${id} | date: ${data.sessionDate || data.date} | teacher: ${data.teacherName} | hasContentLen: ${content.length} | hasCan: ${hasCan}`);
    if (isNov11 || isCharles || hasCan) {
      targetSessionKey = id;
      targetRawNotes = content;
      console.log(`=== MATCH FOUND IN session_notes: ${id} ===`);
      console.log(`  teacherName: ${data.teacherName}`);
      console.log(`  teacherUid: ${data.teacherUid}`);
      console.log(`  studentUid: ${data.studentUid ? data.studentUid.slice(0, 8) + '...' : 'none'}`);
      console.log(`  sessionDate: ${data.sessionDate || data.date}`);
      console.log(`  contentHash in doc: ${data.contentHash}`);
      console.log(`  computedContentHash: ${computeNotesHash(content)}`);
      console.log(`  updatedAt / savedAt: ${data.updatedAt || data.savedAt}`);
      console.log(`  rawContent length: ${content.length}`);
      console.log(`  rawContent preview (first 500 chars):\n${content.slice(0, 500)}`);
      console.log(`  rawContent full:\n${content}`);

      // Check pedagogical_cache subcollection for this session
      const cacheSnap = await doc.ref.collection('pedagogical_cache').get();
      console.log(`  pedagogical_cache docs count: ${cacheSnap.size}`);
      for (const cDoc of cacheSnap.docs) {
        const cData = cDoc.data();
        console.log(`    cache doc id: ${cDoc.id}`);
        console.log(`    modelUsed: ${cData.modelUsed}`);
        console.log(`    isAiGenerated: ${cData.isAiGenerated}`);
        console.log(`    isFallback: ${cData.isFallback}`);
        console.log(`    isProvisional: ${cData.isProvisional}`);
        console.log(`    promptVersion: ${cData.promptVersion}`);
        console.log(`    mistakesAnalysis count: ${cData.mistakesAnalysis?.length || 0}`);
        console.log(`    grammarPoints count: ${cData.grammarPoints?.length || 0}`);
        console.log(`    vocabularyAndExpressions count: ${cData.vocabularyAndExpressions?.length || 0}`);
        console.log(`    reviewSummary:`, JSON.stringify(cData.reviewSummary, null, 2));
        console.log(`    mistakesAnalysis full:`, JSON.stringify(cData.mistakesAnalysis, null, 2));
        console.log(`    grammarPoints full:`, JSON.stringify(cData.grammarPoints, null, 2));
        console.log(`    vocabularyAndExpressions full:`, JSON.stringify(cData.vocabularyAndExpressions, null, 2));
      }
    }
  }

  // 3. Search in 'users' subcollections 'session_notes'
  console.log('\n--- 3. Searching users/{uid}/session_notes ---');
  const usersSnap = await db.collection('users').get();
  for (const uDoc of usersSnap.docs) {
    const uNotesSnap = await uDoc.ref.collection('session_notes').get();
    if (uNotesSnap.size > 0) {
      console.log(`[users/${uDoc.id.slice(0, 8)}.../session_notes] count: ${uNotesSnap.size}`);
      for (const nDoc of uNotesSnap.docs) {
        const nData = nDoc.data();
        const content = String(nData.rawContent || nData.rawNotes || nData.content || '');
        if (nDoc.id.includes('2026-11-11') || content.includes("can't")) {
          console.log(`  Matching user note: ${nDoc.id}`);
          console.log(`  content preview:\n${content.slice(0, 300)}`);
        }
      }
    }
  }

  // 4. Search in 'pedagogicalTransformations' root collection if exists
  console.log('\n--- 4. Checking pedagogicalTransformations collection ---');
  try {
    const ptSnap = await db.collection('pedagogicalTransformations').get();
    console.log(`Total pedagogicalTransformations docs in (default): ${ptSnap.size}`);
    for (const doc of ptSnap.docs) {
      console.log(`  Doc: ${doc.id}`);
    }
  } catch (err: any) {
    console.log(`  Error or not found: ${err.message}`);
  }
}

run().catch(console.error);
