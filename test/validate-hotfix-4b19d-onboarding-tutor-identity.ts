import assert from 'node:assert/strict';
import {
  mergeTutors,
  consolidateTutorsList,
  isValidCanonicalUid,
  isGenericTutorId,
  normalizeTutorName,
} from '../src/utils/tutorConsolidation';
import { resolveTeacherCanonicalIdentity } from '../src/serverFirestore';
import { normalizeTutorDoc } from '../src/hooks/useNativeFriends';

console.log('=========================================================================');
console.log(' INTEGRATION VALIDATION: HOTFIX 4B.19D                                  ');
console.log(' ONBOARDING NATIVE FRIEND IDENTIFIER HARDENING & RESOLUTION              ');
console.log('=========================================================================\n');

async function runValidation() {
  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // 1. normalizeTutorDoc preserves publicTutorId and protects against generic IDs
  await test('normalizeTutorDoc preserves publicTutorId and does not default to "tutor"', () => {
    const rawDoc = {
      id: 'DIFF_UID_REAL_0000000000001',
      publicTutorId: 'different',
      name: 'Different',
      approvalStatus: 'approved',
      isApproved: true,
      pricePerSessionUsd: 25,
    };

    const normalized = normalizeTutorDoc(rawDoc.id, rawDoc);
    assert.ok(normalized, 'Should normalize document');
    assert.equal(normalized?.id, 'DIFF_UID_REAL_0000000000001');
    assert.equal(normalized?.publicTutorId, 'different');
    assert.notEqual(normalized?.id, 'tutor');
    assert.notEqual(normalized?.publicTutorId, 'tutor');
  });

  // 2. normalizeTutorDoc with generic id in doc falls back to safe public slug
  await test('normalizeTutorDoc with generic "tutor" id falls back to safe name slug', () => {
    const rawDoc = {
      id: 'tutor', // Corrupted or legacy generic id
      name: 'Different Native Friend',
      approvalStatus: 'approved',
      isApproved: true,
      pricePerSessionUsd: 20,
    };

    const normalized = normalizeTutorDoc('tutor', rawDoc);
    assert.ok(normalized);
    assert.notEqual(normalized?.id, 'tutor', 'Must not accept generic "tutor" as ID');
    assert.equal(normalized?.publicTutorId, 'different-native-friend');
  });

  // 3. Newly created and approved Native Friend "Different" selected during onboarding
  await test('End-to-end onboarding: Newly created & approved tutor "Different" produces valid non-generic payload', async () => {
    const mockTutors = [
      {
        id: 'SKULL_BEE_UID_000000000000',
        publicTutorId: 'skull-bee',
        name: 'Skull Bee',
        email: 'laviniafofafc@gmail.com',
        approvalStatus: 'approved',
      },
      {
        id: 'DIFF_CANONICAL_UID_999999999',
        uid: 'DIFF_CANONICAL_UID_999999999',
        publicTutorId: 'different',
        name: 'Different',
        email: 'diff@itissimple.com',
        approvalStatus: 'approved',
        isApproved: true,
      },
    ];

    // Simulate Step 4 user interaction: selecting "Different"
    const clickedTutor = mockTutors[1];
    const canonicalUid =
      (clickedTutor.uid && isValidCanonicalUid(clickedTutor.uid) ? clickedTutor.uid.trim() : null) ||
      (clickedTutor.id && isValidCanonicalUid(clickedTutor.id) ? clickedTutor.id.trim() : null);
    const validPublicSlug =
      (clickedTutor.publicTutorId && !isGenericTutorId(clickedTutor.publicTutorId) ? clickedTutor.publicTutorId.trim() : null) ||
      (clickedTutor.id && !isValidCanonicalUid(clickedTutor.id) && !isGenericTutorId(clickedTutor.id) ? clickedTutor.id.trim() : null) ||
      (clickedTutor.name && !isGenericTutorId(clickedTutor.name) ? normalizeTutorName(clickedTutor.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null);

    const tutorIdentifier = canonicalUid || validPublicSlug || clickedTutor.name;
    assert.equal(tutorIdentifier, 'DIFF_CANONICAL_UID_999999999');

    // Simulate wizard selectedTutor resolution
    const selectedTutor = mockTutors.find((t) => {
      if (!tutorIdentifier || isGenericTutorId(tutorIdentifier)) return false;
      return (
        (!isGenericTutorId(t.id) && t.id === tutorIdentifier) ||
        (!isGenericTutorId(t.publicTutorId) && t.publicTutorId === tutorIdentifier) ||
        (t.uid && isValidCanonicalUid(t.uid) && t.uid === tutorIdentifier) ||
        (t.name && normalizeTutorName(t.name) === normalizeTutorName(tutorIdentifier))
      );
    });

    assert.ok(selectedTutor);
    assert.equal(selectedTutor?.name, 'Different');

    // Simulate handleCompleteOnboarding targetTeacherPublicId resolution
    const selectedTutorIdRaw = selectedTutor?.id;
    const selectedTutorPublicIdRaw = (selectedTutor as any)?.publicTutorId;
    const selectedTutorNameRaw = selectedTutor?.name;
    const selectedTutorUidRaw = (selectedTutor as any)?.uid;

    const targetTeacherPublicId =
      (selectedTutorPublicIdRaw && !isGenericTutorId(selectedTutorPublicIdRaw) ? selectedTutorPublicIdRaw.trim() : null) ||
      (selectedTutorIdRaw && !isGenericTutorId(selectedTutorIdRaw) ? selectedTutorIdRaw.trim() : null) ||
      (selectedTutorNameRaw && !isGenericTutorId(selectedTutorNameRaw) ? normalizeTutorName(selectedTutorNameRaw).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null) ||
      '';

    const effectiveTeacherId = !isGenericTutorId(targetTeacherPublicId) ? targetTeacherPublicId : (selectedTutorUidRaw || undefined);

    assert.notEqual(effectiveTeacherId, 'tutor');
    assert.equal(effectiveTeacherId, 'different');

    // Simulate backend resolution
    const resolved = await resolveTeacherCanonicalIdentity({
      teacherId: effectiveTeacherId,
      publicTutorId: effectiveTeacherId,
      teacherUid: selectedTutorUidRaw,
      teacherName: selectedTutorNameRaw,
      dbState: { tutorsList: mockTutors, teachers: [] },
    });

    assert.ok(resolved);
    assert.equal(resolved?.canonicalUid, 'DIFF_CANONICAL_UID_999999999');
    assert.equal(resolved?.name, 'Different');
  });

  // 4. Reference Case: Skull Bee resolution remains rock-solid
  await test('Reference Case: Skull Bee resolution remains canonical', async () => {
    const resolved = await resolveTeacherCanonicalIdentity({
      teacherId: 'skull-bee',
      publicTutorId: 'skull-bee',
      teacherEmail: 'laviniafofafc@gmail.com',
    });

    assert.ok(resolved);
    assert.equal(resolved?.canonicalUid, 'jCkNIhvYEYbyJC2CWGZhFaoHGfo1');
    assert.equal(resolved?.publicTutorId, 'skull-bee');
  });

  // 5. Reference Case: Queen Bee resolution remains canonical
  await test('Reference Case: Queen Bee resolution remains canonical', async () => {
    const resolved = await resolveTeacherCanonicalIdentity({
      teacherId: 'queen-bee',
      publicTutorId: 'queen-bee',
      teacherEmail: 'beeginning4you@gmail.com',
    });

    assert.ok(resolved);
    assert.equal(resolved?.canonicalUid, 'Xpmq4l50aUOE0Jh4UTHwGAtw65B2');
    assert.equal(resolved?.publicTutorId, 'queen-bee');
  });

  console.log('\n=========================================================================');
  console.log(` TOTAL TEST RESULTS: ${passed} PASSED, ${total - passed} FAILED`);
  console.log('=========================================================================\n');
}

runValidation().catch((err) => {
  console.error('Validation failure:', err);
  process.exit(1);
});
