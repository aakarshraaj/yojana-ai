const test = require('node:test');
const assert = require('node:assert/strict');

const { createRetrievalFlow } = require('../src/handlers/chat/retrievalFlow');

test('dispatches complaint intent to complaint handler', async () => {
  let called = '';
  const flow = createRetrievalFlow({
    complaintHandler: async () => {
      called = 'complaint';
      return 'ok';
    },
    compareHandler: async () => {
      called = 'compare';
      return 'bad';
    },
    focusedHandler: async () => null,
    discoveryHandler: async () => 'bad2',
  });

  const result = await flow({ intent: 'complaint_correction' });
  assert.equal(called, 'complaint');
  assert.equal(result, 'ok');
});

test('dispatches compare intent to compare handler', async () => {
  let called = '';
  const flow = createRetrievalFlow({
    complaintHandler: async () => 'bad',
    compareHandler: async () => {
      called = 'compare';
      return 'ok';
    },
    focusedHandler: async () => null,
    discoveryHandler: async () => 'bad2',
  });

  const result = await flow({ intent: 'compare_request' });
  assert.equal(called, 'compare');
  assert.equal(result, 'ok');
});

test('uses focused handler result when present', async () => {
  let called = '';
  const flow = createRetrievalFlow({
    complaintHandler: async () => 'bad',
    compareHandler: async () => 'bad',
    focusedHandler: async () => {
      called = 'focused';
      return 'focused-response';
    },
    discoveryHandler: async () => {
      called = 'discovery';
      return 'bad2';
    },
  });

  const result = await flow({ intent: 'detail_request' });
  assert.equal(called, 'focused');
  assert.equal(result, 'focused-response');
});

test('falls back to discovery when focused handler returns null', async () => {
  let called = '';
  const flow = createRetrievalFlow({
    complaintHandler: async () => 'bad',
    compareHandler: async () => 'bad',
    focusedHandler: async () => null,
    discoveryHandler: async () => {
      called = 'discovery';
      return 'discovery-response';
    },
  });

  const result = await flow({ intent: 'new_discovery' });
  assert.equal(called, 'discovery');
  assert.equal(result, 'discovery-response');
});
