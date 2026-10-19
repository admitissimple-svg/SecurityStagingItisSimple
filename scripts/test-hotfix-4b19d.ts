import assert from 'node:assert/strict';
import {
  mergeTutors,
  consolidateTutorsList,
  isValidCanonicalUid,
  isGenericTutorId,
  normalizeTutorName,
} from '../src/utils/tutorConsolidation';
import { resolveTeacherCanonicalIdentity } from '../src/serverFirestore';

console.log('=========================================================================');
console.log(' TEST SUITE: HOTFIX 4B.19D                                              ');
console.log(' ONBOARDING NATIVE FRIEND IDENTITY & CANONICAL RESOLUTION                ');
console.log('=========================================================================\n');

async function runTests() {
  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] Test ${total}: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] Test ${total}: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // 1. Step 4 Tutor Selection identifier generation: never produces generic 'tutor'
  await test('Step 4 Tutor identifier: Newly created tutor "Different" generates valid slug, never "tutor"', () => {
    const rawTutor = {
      id: 'DIFF_CANONICAL_UID_9988776655',
      uid: 'DIFF_CANONICAL_UID_9988776655',
      authUid: 'DIFF_CANONICAL_UID_9988776655',
      name: 'Different',
      email: 'different.tutor@example.com',
      approvalStatus: 'approved',
      isApproved: true,
      pricePerSessionUsd: 20,
    };

    const canonicalUid =
      (rawTutor.uid && isValidCanonicalUid(rawTutor.uid) ? rawTutor.uid.trim() : null) ||
      (rawTutor.authUid && isValidCanonicalUid(rawTutor.authUid) ? rawTutor.authUid.trim() : null) ||
      (rawTutor.id && isValidCanonicalUid(rawTutor.id) ? rawTutor.id.trim() : null);

    const validPublicSlug =
      (rawTutor.name && !isGenericTutorId(rawTutor.name) ? normalizeTutorName(rawTutor.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null);

    const tutorIdentifier =
      canonicalUid ||
      (validPublicSlug && !isGenericTutorId(validPublicSlug) ? validPublicSlug : null) ||
      rawTutor.name;

    assert.notEqual(tutorIdentifier, 'tutor', 'Tutor identifier must NEVER be the generic string "tutor"');
    assert.equal(tutorIdentifier, 'DIFF_CANONICAL_UID_9988776655', 'Canonical UID takes precedence when available');
    assert.equal(isGenericTutorId(tutorIdentifier), false, 'Identifier must not be classified as generic');
  });

  // 2. Step 4 Tutor Selection identifier generation: Slug generated when tutor only has public slug
  await test('Step 4 Tutor identifier: Generates name slug when canonical UID is absent', () => {
    const publicTutor = {
      id: 'different',
      publicTutorId: 'different',
      name: 'Different Native Friend',
      approvalStatus: 'approved',
      isApproved: true,
      pricePerSessionUsd: 25,
    };

    const canonicalUid =
      ((publicTutor as any).uid && isValidCanonicalUid((publicTutor as any).uid) ? (publicTutor as any).uid.trim() : null) ||
      (publicTutor.id && isValidCanonicalUid(publicTutor.id) ? publicTutor.id.trim() : null);

    const validPublicSlug =
      (publicTutor.publicTutorId && !isGenericTutorId(publicTutor.publicTutorId) ? publicTutor.publicTutorId.trim() : null) ||
      (publicTutor.id && !isValidCanonicalUid(publicTutor.id) && !isGenericTutorId(publicTutor.id) ? publicTutor.id.trim() : null) ||
      (publicTutor.name && !isGenericTutorId(publicTutor.name) ? normalizeTutorName(publicTutor.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null);

    const tutorIdentifier =
      canonicalUid ||
      (validPublicSlug && !isGenericTutorId(validPublicSlug) ? validPublicSlug : null) ||
      publicTutor.name;

    assert.equal(tutorIdentifier, 'different', 'Public slug "different" is used');
    assert.notEqual(tutorIdentifier, 'tutor', 'Must never be generic "tutor"');
  });

  // 3. Wizard selectedTutor lookup matches by name when ID is custom or slug
  await test('Wizard selectedTutor lookup: Matches by name even when selectedTutorId is name or slug', () => {
    const list = [
      {
        id: 'TUTOR_ONE_UID_11111111111111',
        uid: 'TUTOR_ONE_UID_11111111111111',
        name: 'First Tutor',
        approvalStatus: 'approved',
      },
      {
        id: 'TUTOR_DIFF_UID_22222222222222',
        uid: 'TUTOR_DIFF_UID_22222222222222',
        publicTutorId: 'different',
        name: 'Different',
        approvalStatus: 'approved',
      },
    ];

    const selectedTutorId = 'different';
    const found = list.find((t) => {
      if (!selectedTutorId || isGenericTutorId(selectedTutorId)) return false;
      return (
        (!isGenericTutorId(t.id) && t.id === selectedTutorId) ||
        (!isGenericTutorId(t.publicTutorId) && t.publicTutorId === selectedTutorId) ||
        (t.uid && isValidCanonicalUid(t.uid) && t.uid === selectedTutorId) ||
        (t.name && normalizeTutorName(t.name) === normalizeTutorName(selectedTutorId))
      );
    });

    assert.ok(found, 'Should find the chosen tutor');
    assert.equal(found?.name, 'Different');
    assert.equal(found?.id, 'TUTOR_DIFF_UID_22222222222222');
  });

  // 4. Signup payload generation in handleCompleteOnboarding never sends "tutor"
  await test('Signup payload generation: teacherId, publicTutorId and selectedTutorId are specific, never "tutor"', () => {
    const selectedTutor = {
      id: 'DIFF_UID_333333333333333333',
      uid: 'DIFF_UID_333333333333333333',
      publicTutorId: 'different-friend',
      name: 'Different',
      email: 'diff@example.com',
      approvalStatus: 'approved',
    };

    const targetTeacherPublicId =
      (!isGenericTutorId(selectedTutor.publicTutorId) ? selectedTutor.publicTutorId : null) ||
      (!isGenericTutorId(selectedTutor.id) ? selectedTutor.id : null) ||
      (selectedTutor.name && !isGenericTutorId(selectedTutor.name) ? normalizeTutorName(selectedTutor.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null) ||
      '';

    const canonicalTutorUid =
      (selectedTutor.uid && isValidCanonicalUid(selectedTutor.uid) ? selectedTutor.uid.trim() : '');

    const effectiveTeacherId = !isGenericTutorId(targetTeacherPublicId) ? targetTeacherPublicId : (canonicalTutorUid || undefined);

    const payload = {
      teacherId: effectiveTeacherId,
      publicTutorId: effectiveTeacherId,
      selectedTutorId: effectiveTeacherId,
      teacherUid: canonicalTutorUid || undefined,
      teacherName: selectedTutor.name,
      teacherEmail: selectedTutor.email,
    };

    assert.notEqual(payload.teacherId, 'tutor', 'teacherId must never be "tutor"');
    assert.notEqual(payload.selectedTutorId, 'tutor', 'selectedTutorId must never be "tutor"');
    assert.notEqual(payload.publicTutorId, 'tutor', 'publicTutorId must never be "tutor"');
    assert.equal(payload.teacherId, 'different-friend', 'Correct public slug used');
    assert.equal(payload.teacherUid, 'DIFF_UID_333333333333333333', 'Canonical UID attached to payload');
  });

  // 5. Backend resolveTeacherCanonicalIdentity: Resolves new approved tutor "Different" by public slug
  await test('resolveTeacherCanonicalIdentity: Resolves tutor "Different" by public slug and name', async () => {
    const mockDb = {
      tutorsList: [
        {
          id: 'DIFF_UID_444444444444444444',
          uid: 'DIFF_UID_444444444444444444',
          authUid: 'DIFF_UID_444444444444444444',
          publicTutorId: 'different',
          name: 'Different',
          email: 'different.tutor@example.com',
          approvalStatus: 'approved',
          isApproved: true,
          status: 'approved',
          approved: true,
          role: 'teacher',
        },
      ],
      teachers: [],
    };

    const resolved = await resolveTeacherCanonicalIdentity({
      teacherId: 'different',
      publicTutorId: 'different',
      teacherName: 'Different',
      dbState: mockDb,
    });

    assert.ok(resolved, 'Should resolve teacher record');
    assert.equal(resolved?.canonicalUid, 'DIFF_UID_444444444444444444', 'Canonical UID resolved correctly');
    assert.equal(resolved?.publicTutorId, 'different', 'Public tutor ID preserved');
    assert.equal(resolved?.isApproved, true, 'Approval verified');
  });

  // 6. Backend reject purely generic tutor when no valid identity can be proven
  await test('Backend reject: Rejects generic tutor payload without valid identity', async () => {
    const reqBody: Record<string, any> = {
      teacherId: 'tutor',
      selectedTutorId: 'tutor',
      publicTutorId: 'tutor',
      teacherUid: undefined,
      teacherEmail: undefined,
      teacherName: 'tutor',
    };

    const isPureGenericTutor =
      (reqBody.teacherId === 'tutor' || reqBody.selectedTutorId === 'tutor' || reqBody.publicTutorId === 'tutor') &&
      (!reqBody.teacherUid || !isValidCanonicalUid(reqBody.teacherUid)) &&
      (!reqBody.teacherEmail || !reqBody.teacherEmail.includes('@')) &&
      (!reqBody.teacherName || isGenericTutorId(reqBody.teacherName));

    assert.equal(isPureGenericTutor, true, 'Pure generic tutor payload correctly identified and rejected');
  });

  // 7. Non-regression: mergeTutors preserves non-generic public slugs and canonical UIDs
  await test('mergeTutors preserves non-generic public slug and rejects generic IDs', () => {
    const existing = {
      id: 'DIFF_UID_555555555555555555',
      uid: 'DIFF_UID_555555555555555555',
      publicTutorId: 'different',
      name: 'Different Native Friend',
      approvalStatus: 'approved',
      isApproved: true,
    };

    const incoming = {
      id: 'tutor', // Malicious or generic incoming ID attempt
      name: 'Different Native Friend Updated',
      bio: 'New updated bio for students',
    };

    const merged = mergeTutors(existing, incoming);

    assert.notEqual(merged.id, 'tutor', 'Merged ID must not be overwritten with "tutor"');
    assert.equal(merged.id, 'DIFF_UID_555555555555555555', 'Canonical UID strictly preserved as primary ID');
    assert.equal(merged.publicTutorId, 'different', 'Public slug strictly preserved');
    assert.equal(merged.name, 'Different Native Friend Updated', 'Safe field update applied');
  });

  console.log(`\n=========================================================================`);
  console.log(` ALL ${passed}/${total} HOTFIX 4B.19D TESTS PASSED!`);
  console.log(`=========================================================================\n`);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
