const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectProfileConflict,
  parseLeadingDecision,
  isUndoProfileChangeCommand,
} = require('../src/services/profile');

test('detects state conflict', () => {
  const conflict = detectProfileConflict({ state: 'punjab' }, { state: 'maharashtra' });
  assert.deepEqual(conflict, { field: 'state', from: 'punjab', to: 'maharashtra' });
});

test('detects category conflict', () => {
  const conflict = detectProfileConflict({ category: 'obc' }, { category: 'sc' });
  assert.deepEqual(conflict, { field: 'category', from: 'obc', to: 'sc' });
});

test('detects profession conflict', () => {
  const conflict = detectProfileConflict({ profession: 'student' }, { profession: 'farmer' });
  assert.deepEqual(conflict, { field: 'profession', from: 'student', to: 'farmer' });
});

test('detects income conflict', () => {
  const conflict = detectProfileConflict({ incomeAnnual: 100000 }, { incomeAnnual: 300000 });
  assert.deepEqual(conflict, { field: 'incomeAnnual', from: 100000, to: 300000 });
});

test('parses mixed yes decision with remainder', () => {
  const parsed = parseLeadingDecision('yes scholarship for girls');
  assert.equal(parsed.decision, 'yes');
  assert.equal(parsed.remainder, 'scholarship for girls');
});

test('parses mixed no decision with remainder', () => {
  const parsed = parseLeadingDecision('no keep old one');
  assert.equal(parsed.decision, 'no');
  assert.equal(parsed.remainder, 'keep old one');
});

test('detects undo profile command', () => {
  assert.equal(isUndoProfileChangeCommand('undo last change'), true);
  assert.equal(isUndoProfileChangeCommand('something else'), false);
});
