import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultTab, isPanelTab } from './tab.ts';

test('a stored tab wins', () => {
  assert.equal(defaultTab({ stored: 'sandboxes', sandboxId: 'bx_1', conversations: 3 }), 'sandboxes');
  assert.equal(defaultTab({ stored: 'conversations', sandboxId: null, conversations: 0 }), 'conversations');
});

test('without a stored tab, a sandbox with conversations opens Conversations', () => {
  assert.equal(defaultTab({ stored: null, sandboxId: 'bx_1', conversations: 2 }), 'conversations');
});

test('without a stored tab, no conversations means Sandboxes', () => {
  assert.equal(defaultTab({ stored: null, sandboxId: 'bx_1', conversations: 0 }), 'sandboxes');
  assert.equal(defaultTab({ stored: null, sandboxId: null, conversations: 0 }), 'sandboxes');
});

test('only the two tab ids are accepted', () => {
  assert.equal(isPanelTab('sandboxes'), true);
  assert.equal(isPanelTab('conversations'), true);
  assert.equal(isPanelTab('settings'), false);
});
