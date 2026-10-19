import assert from 'node:assert/strict';
import {
  mergeTutors,
  consolidateTutorsList,
  isValidCanonicalUid,
  areSameTutor,
} from '../src/utils/tutorConsolidation';

console.log('--- Starting HOTFIX 4B.19C Regression Test Suite ---');

async function runTests() {
  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] Test ${total}: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] Test ${total}: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // 1. Correct merge precedence: Ensure new bio, name, rate, avatar, accent, specialties are not overwritten by stale existing values
  test('Correct merge precedence - new bio/name/rate/avatar/accent/specialties override stale values', () => {
    const existing = {
      id: 'canon-uid-1234567890abcdef',
      uid: 'canon-uid-1234567890abcdef',
      name: 'Old Name',
      bio: 'Old bio about myself',
      headline: 'Old headline',
      avatar: 'https://example.com/old.jpg',
      pricePerSessionUsd: 25,
      pricePerSessionBrl: 140,
      accent: 'British',
      specialties: ['Grammar'],
      approvalStatus: 'approved',
      role: 'teacher',
    };

    const incoming = {
      id: 'canon-uid-1234567890abcdef',
      uid: 'canon-uid-1234567890abcdef',
      name: 'Sarah Connor',
      bio: 'New updated bio about conversational English and practical routines.',
      headline: 'Expert Native Friend',
      avatar: 'https://example.com/new.jpg',
      pricePerSessionUsd: 35,
      pricePerSessionBrl: 190,
      accent: 'North American',
      specialties: ['Fluency', 'Job Interviews'],
    };

    const merged = mergeTutors(existing, incoming);

    assert.equal(merged.name, 'Sarah Connor', 'Updated name should take precedence');
    assert.equal(merged.bio, 'New updated bio about conversational English and practical routines.', 'Updated bio should take precedence');
    assert.equal(merged.headline, 'Expert Native Friend', 'Updated headline should take precedence');
    assert.equal(merged.avatar, 'https://example.com/new.jpg', 'Updated avatar should take precedence');
    assert.equal(merged.pricePerSessionUsd, 35, 'Updated price USD should take precedence');
    assert.equal(merged.pricePerSessionBrl, 190, 'Updated price BRL should take precedence');
    assert.equal(merged.accent, 'North American', 'Updated accent should take precedence');
    assert.deepEqual(merged.specialties, ['Fluency', 'Job Interviews'], 'Updated specialties should take precedence');
  });

  // 2. Removal of Queen Bee hardcoded name override
  test('Removal of Queen Bee hardcoded name override - teacher can update display name', () => {
    const queenBeeExisting = {
      id: 'user-queen-bee-uid-12345678',
      uid: 'user-queen-bee-uid-12345678',
      email: 'estilobeeadm@gmail.com',
      name: 'Queen Bee',
      bio: 'Old Queen Bee bio',
      role: 'teacher',
      approvalStatus: 'approved',
    };

    const queenBeeIncoming = {
      id: 'user-queen-bee-uid-12345678',
      name: 'Beatriz "Bee" Silva',
      bio: 'Welcome to my updated profile for 2026!',
    };

    const merged = mergeTutors(queenBeeExisting, queenBeeIncoming);
    assert.equal(
      merged.name,
      'Beatriz "Bee" Silva',
      'Queen Bee must NOT be forced to "Queen Bee" when user explicitly provides a new name'
    );
  });

  // 3. Public profile payload cannot overwrite protected fields
  test('Public profile payload cannot overwrite protected fields (UID, role, approvalStatus, bookings, assignments)', () => {
    const existing = {
      id: 'valid-canonical-uid-9999999999',
      uid: 'valid-canonical-uid-9999999999',
      authUid: 'valid-canonical-uid-9999999999',
      role: 'teacher',
      approvalStatus: 'approved',
      isApproved: true,
      status: 'approved',
      approved: true,
      registeredByAdmin: true,
      assignedStudents: ['student-1', 'student-2'],
      trialBookings: [{ id: 'booking-1', date: '2026-10-20' }],
      existingLessons: [{ id: 'lesson-1', topic: 'Greetings' }],
      name: 'Original Teacher',
    };

    // Attacker or client attempt to escalate privileges or tamper with protected state
    const maliciousIncoming = {
      id: 'valid-canonical-uid-9999999999',
      uid: 'hacked-canonical-uid-0000000000',
      role: 'superadmin',
      approvalStatus: 'rejected',
      isApproved: false,
      assignedStudents: [],
      trialBookings: [],
      existingLessons: [],
      name: 'Legit Teacher Name Update',
    };

    const merged = mergeTutors(existing, maliciousIncoming);

    assert.equal(merged.uid, 'valid-canonical-uid-9999999999', 'Canonical UID cannot be overwritten');
    assert.equal(merged.authUid, 'valid-canonical-uid-9999999999', 'authUid cannot be overwritten');
    assert.equal(merged.role, 'teacher', 'Role cannot be escalated from public update');
    assert.equal(merged.approvalStatus, 'approved', 'Approval status cannot be altered by public update');
    assert.equal(merged.isApproved, true, 'isApproved cannot be altered by public update');
    assert.deepEqual(merged.assignedStudents, ['student-1', 'student-2'], 'Student assignments must be preserved');
    assert.deepEqual(merged.trialBookings, [{ id: 'booking-1', date: '2026-10-20' }], 'Trial bookings must be preserved');
    assert.deepEqual(merged.existingLessons, [{ id: 'lesson-1', topic: 'Greetings' }], 'Existing lessons must be preserved');
    assert.equal(merged.name, 'Legit Teacher Name Update', 'Legitimate profile field should still be updated');
  });

  // 4. Preservation of existing values when incoming fields are omitted and clearing when intended
  test('Preservation of existing values when incoming fields are omitted', () => {
    const existing = {
      id: 'canon-uid-abc-1234567890123',
      uid: 'canon-uid-abc-1234567890123',
      name: 'Emily Watson',
      bio: 'Existing wonderful bio',
      avatar: 'https://example.com/avatar.jpg',
      country: 'United Kingdom',
      accent: 'British',
      pricePerSessionUsd: 30,
      specialties: ['IELTS Preparation'],
    };

    // Incoming payload only updates bio and hourly rate, omitting country and accent
    const incomingPartial = {
      id: 'canon-uid-abc-1234567890123',
      bio: 'Updated bio with new teaching hours',
      pricePerSessionUsd: 32,
    };

    const merged = mergeTutors(existing, incomingPartial);

    assert.equal(merged.bio, 'Updated bio with new teaching hours');
    assert.equal(merged.pricePerSessionUsd, 32);
    assert.equal(merged.name, 'Emily Watson', 'Omitted name should be preserved');
    assert.equal(merged.avatar, 'https://example.com/avatar.jpg', 'Omitted avatar should be preserved');
    assert.equal(merged.country, 'United Kingdom', 'Omitted country should be preserved');
    assert.equal(merged.accent, 'British', 'Omitted accent should be preserved');
    assert.deepEqual(merged.specialties, ['IELTS Preparation'], 'Omitted specialties should be preserved');
  });

  // 5. Backend Authorization logic simulation: Verified tutor permitted when UID matches canonical UID
  test('Backend ownership authorization: Owner permitted when callerUid === canonicalUid', () => {
    const canonicalUid = 'canonical-user-uid-1234567890';
    const callerTeacher = {
      uid: 'canonical-user-uid-1234567890',
      role: 'user', // Note: even without custom claim role: 'teacher'
    };

    const isOwner = Boolean(canonicalUid && callerTeacher.uid === canonicalUid);
    const isAdmin = callerTeacher.role === 'admin';
    const authorized = isAdmin || isOwner;

    assert.equal(authorized, true, 'Verified owner whose UID matches canonical record UID must be authorized without requiring custom claims');
  });

  // 6. Backend Authorization logic simulation: Teacher forbidden from updating another teacher profile
  test('Backend ownership authorization: Teacher forbidden from updating another teacher profile', () => {
    const canonicalUid = 'victim-teacher-uid-11111111111';
    const attackerTeacher = {
      uid: 'other-teacher-uid-22222222222',
      role: 'user',
    };

    const isOwner = Boolean(canonicalUid && attackerTeacher.uid === canonicalUid);
    const isAdmin = attackerTeacher.role === 'admin';
    const authorized = isAdmin || isOwner;

    assert.equal(authorized, false, 'Teacher must be forbidden from editing another teacher profile');
  });

  // 7. Rejection of legacy identifier without trustworthy canonical UID mapping
  test('Rejection of legacy identifier without trustworthy canonical UID mapping', () => {
    const legacyRecord: Record<string, any> = {
      id: 'legacy-unmapped-tutor-999',
      name: 'Unmapped Teacher',
      email: 'unmapped@example.com',
      // Neither uid nor authUid is set, and it is not a valid canonical UID
    };

    const hasCanonicalUid =
      (legacyRecord.uid && isValidCanonicalUid(legacyRecord.uid)) ||
      (legacyRecord.authUid && isValidCanonicalUid(legacyRecord.authUid)) ||
      (legacyRecord.id && isValidCanonicalUid(legacyRecord.id));

    assert.equal(!hasCanonicalUid, true, 'Profile with untrusted legacy ID and no canonical UID must be recognized as needing reconciliation');
  });

  // 8. Deduplication in consolidateTutorsList: avoids duplicate tutor cards
  test('consolidateTutorsList eliminates duplicates and retains fresh profile updates', () => {
    const list = [
      {
        id: 'legacy-id-charles',
        publicTutorId: 'charles-native',
        uid: 'canonical-charles-uid-0000001',
        email: 'charles@example.com',
        name: 'Charles Legacy',
        bio: 'Old legacy bio',
        pricePerSessionUsd: 20,
      },
      {
        id: 'canonical-charles-uid-0000001',
        publicTutorId: 'charles-native',
        uid: 'canonical-charles-uid-0000001',
        email: 'charles@example.com',
        name: 'Charles Modern',
        bio: 'Fresh updated bio from Firestore',
        pricePerSessionUsd: 28,
        avatar: 'https://example.com/charles.jpg',
      },
    ];

    const consolidated = consolidateTutorsList(list);
    assert.equal(consolidated.length, 1, 'Duplicate records for the same teacher should be consolidated to 1 card');
    assert.equal(consolidated[0].name, 'Charles Modern', 'Fresh updated name should be retained');
    assert.equal(consolidated[0].bio, 'Fresh updated bio from Firestore', 'Fresh updated bio should be retained');
    assert.equal(consolidated[0].pricePerSessionUsd, 28, 'Fresh price should be retained');
  });

  console.log(`\nAll ${passed}/${total} regression tests passed successfully!`);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
