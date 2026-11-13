import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultTab, isPanelTab } from './tab.ts';

test('a stored tab wins', () => {
  assert.equal(defaultTab({ stored: 'sandboxes', sandboxId: 'bx_1', sessions: 3 }), 'sandboxes');
  assert.equal(defaultTab({ stored: 'sessions', sandboxId: null, sessions: 0 }), 'sessions');
});

test('without a stored tab, a sandbox with sessions opens Sessions', () => {
  assert.equal(defaultTab({ stored: null, sandboxId: 'bx_1', sessions: 2 }), 'sessions');
});

test('without a stored tab, no sessions means Sandboxes', () => {
  assert.equal(defaultTab({ stored: null, sandboxId: 'bx_1', sessions: 0 }), 'sandboxes');
  assert.equal(defaultTab({ stored: null, sandboxId: null, sessions: 0 }), 'sandboxes');
});

test('only the two tab ids are accepted', () => {
  assert.equal(isPanelTab('sandboxes'), true);
  assert.equal(isPanelTab('sessions'), true);
  assert.equal(isPanelTab('conversations'), false);
  assert.equal(isPanelTab('settings'), false);
});
