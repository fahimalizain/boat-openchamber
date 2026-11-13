import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settleConversation } from './selection.ts';

test('a conversation in the list stays selected with no pending mark', () => {
  assert.deepEqual(
    settleConversation({ conversationId: 'c1', pendingSince: 1_000 }, ['c0', 'c1'], 2_000),
    { conversationId: 'c1', pendingSince: null },
  );
});

test('a just-started conversation survives a short absence', () => {
  assert.deepEqual(
    settleConversation({ conversationId: 'c1', pendingSince: 1_000 }, ['c0'], 10_000),
    { conversationId: 'c1', pendingSince: 1_000 },
  );
});

test('a stale conversation is cleared after the grace window', () => {
  assert.deepEqual(
    settleConversation({ conversationId: 'c1', pendingSince: 1_000 }, ['c0'], 30_000),
    { conversationId: null, pendingSince: null },
  );
  assert.deepEqual(
    settleConversation({ conversationId: 'c1', pendingSince: null }, ['c0'], 1_100),
    { conversationId: null, pendingSince: null },
  );
});

test('no selection stays no selection', () => {
  assert.deepEqual(settleConversation({ conversationId: null, pendingSince: 5 }, []), {
    conversationId: null,
    pendingSince: null,
  });
});
