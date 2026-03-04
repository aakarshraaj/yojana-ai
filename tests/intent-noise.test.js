const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyIntent } = require('../src/services/intent');

test('does not classify short profile-like answer as smalltalk noise when pending question exists', () => {
  const result = classifyIntent('ok maharashtra', { pendingQuestion: 'which state do you live in' });
  assert.notEqual(result.intent, 'smalltalk_noise');
});

test('does not classify mixed gratitude + profession as smalltalk noise', () => {
  const result = classifyIntent('thanks farmer', { pendingQuestion: null });
  assert.notEqual(result.intent, 'smalltalk_noise');
});

test('still classifies plain short chatter as smalltalk noise without pending context', () => {
  const result = classifyIntent('ok thanks', { pendingQuestion: null });
  assert.equal(result.intent, 'smalltalk_noise');
});
