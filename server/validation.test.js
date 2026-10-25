const test = require('node:test');
const assert = require('node:assert/strict');
const { allowedTransitions, validateComplaint, validateProfile } = require('./validation');
const { hashOtp } = require('./security');

test('complaint validation rejects missing required fields', () => {
  assert.equal(validateComplaint({ category: 'Academics' }), 'Missing: subcategory, title, description');
});

test('complaint validation accepts a complete known category', () => {
  assert.equal(validateComplaint({ category: 'Academics', subcategory: 'Teaching Feedback', title: 'Exam issue', description: 'Details' }), null);
});

test('complaint validation rejects a subcategory from another category', () => {
  assert.equal(validateComplaint({ category: 'Hostel', subcategory: 'Fee Payment', title: 'Wrong charge', description: 'Details' }), 'Invalid subcategory for selected category');
});

test('status transitions do not reopen a submitted complaint directly', () => {
  assert.deepEqual(allowedTransitions.Submitted, ['Under Review']);
});

test('OTP hashing is deterministic without storing the plaintext code', () => {
  process.env.OTP_SECRET = 'test-secret';
  const digest = hashOtp('student@example.com', '123456');
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, '123456');
});

test('complaint verification OTP hash is separate from login OTP hash', () => {
  process.env.OTP_SECRET = 'test-secret';
  assert.notEqual(
    hashOtp('student@example.com', '123456'),
    hashOtp('student@example.com:challenge-id', '123456')
  );
});

test('profile validation requires exactly ten mobile digits', () => {
  const profile = { name: 'Student', studentUid: 'S1', fatherGuardianName: 'Parent', course: 'BCA', semester: '1', mobileNumber: '93506439' };
  assert.equal(validateProfile(profile), 'Enter a valid 10-digit Indian mobile number');
  assert.equal(validateProfile({ ...profile, mobileNumber: '9350643912' }), null);
  assert.equal(validateProfile({ ...profile, mobileNumber: '5350643912' }), 'Enter a valid 10-digit Indian mobile number');
});
