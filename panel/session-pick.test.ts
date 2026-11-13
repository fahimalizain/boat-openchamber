import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { OpencodeSession } from '../shared/opencode.ts';
import { timeAgoAt } from '../shared/time.ts';
import {
  directoryChoices,
  folderOf,
  orderSessions,
  placeSwitcher,
  sessionItems,
  showsInlinePicker,
} from './session-pick.ts';

const session = (over: Partial<OpencodeSession> & { id: string }): OpencodeSession => ({
  title: null,
  directory: '/home/user',
  projectID: null,
  agent: null,
  model: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  busyAt: null,
  idleAt: null,
  archived: false,
  outcome: null,
  status: 'idle',
  cost: 0,
  ...over,
});

test('busy sessions come first, then the most recently updated', () => {
  const rows = orderSessions([
    session({ id: 'old', updatedAt: 1_000 }),
    session({ id: 'busy-old', status: 'busy', updatedAt: 2_000 }),
    session({ id: 'new', updatedAt: 5_000 }),
    session({ id: 'busy-new', status: 'busy', updatedAt: 3_000 }),
  ]);

  assert.deepEqual(rows.map((row) => row.id), ['busy-new', 'busy-old', 'new', 'old']);
});

test('sessions with the same stamp fall back to their id, and the input is left alone', () => {
  const input = [
    session({ id: 'b', updatedAt: 4_000 }),
    session({ id: 'a', updatedAt: 4_000 }),
    session({ id: 'c', updatedAt: 4_000 }),
  ];
  const rows = orderSessions(input);

  assert.deepEqual(rows.map((row) => row.id), ['a', 'b', 'c']);
  assert.deepEqual(input.map((row) => row.id), ['b', 'a', 'c']);
});

test('a row holds a clipped title, its status and how long ago it changed', () => {
  const at = Date.now() - 2 * 60_000;
  const items = sessionItems([
    session({ id: 'long', title: 'x'.repeat(90), status: 'error', updatedAt: at }),
    session({ id: 'fresh', title: null, status: 'busy', updatedAt: at }),
  ]);

  assert.equal(items[0]?.id, 'fresh');
  assert.equal(items[0]?.title, 'New session');
  assert.deepEqual(items[0]?.badge, { label: 'busy', tone: 'success' });
  assert.equal(items[1]?.title.length, 70);
  assert.deepEqual(items[1]?.badge, { label: 'error', tone: 'error' });
  assert.equal(items[1]?.meta, timeAgoAt(at));
});

test('the directory picker hides itself when there is nowhere to switch', () => {
  assert.deepEqual(directoryChoices([], ''), []);
  assert.deepEqual(directoryChoices([], '/home/user/app'), [
    { id: '/home/user/app', label: 'app', hint: '/home/user/app' },
  ]);
  assert.deepEqual(directoryChoices(['/home/user', '/home/user/app'], '').map((row) => row.label), [
    'user',
    'app',
  ]);
  assert.equal(folderOf('/home/user/'), 'user');
  assert.equal(folderOf('/'), '/');
  assert.equal(folderOf(null), '');
});

test('the inline picker stands in only when a transcript should not', () => {
  const base = { sandboxId: 'bx_1', stopped: false, sessionId: null, chat: false };
  assert.equal(showsInlinePicker(base), true);
  assert.equal(showsInlinePicker({ ...base, sandboxId: null }), false);
  assert.equal(showsInlinePicker({ ...base, stopped: true }), false);
  assert.equal(showsInlinePicker({ ...base, sessionId: 'ses_1' }), false);
  assert.equal(showsInlinePicker({ ...base, chat: true }), false);
});

test('the card opens below its header when there is room', () => {
  const placement = placeSwitcher(
    { left: 20, top: 100, bottom: 132, width: 300 },
    { width: 300, height: 200 },
    { width: 400, height: 700 },
  );

  assert.deepEqual(placement, { left: 20, top: 136, width: 300, maxHeight: 556, above: false });
});

test('the card flips above when the room below cannot hold it', () => {
  const placement = placeSwitcher(
    { left: 20, top: 600, bottom: 632, width: 300 },
    { width: 300, height: 200 },
    { width: 400, height: 700 },
  );

  assert.equal(placement.above, true);
  assert.equal(placement.top, 396);
  assert.equal(placement.maxHeight, 588);
});

test('the card stays inside the viewport and never asks for a negative height', () => {
  const squeezed = placeSwitcher(
    { left: 350, top: 20, bottom: 50, width: 120 },
    { width: 300, height: 400 },
    { width: 400, height: 120 },
  );
  assert.equal(squeezed.left, 92);
  assert.equal(squeezed.width, 300);
  assert.ok(squeezed.maxHeight >= 0);

  const phone = placeSwitcher(
    { left: 12, top: 80, bottom: 112, width: 366 },
    { width: 366, height: 240 },
    { width: 390, height: 844 },
    { compact: true },
  );
  assert.deepEqual(phone, { left: 8, top: 116, width: 374, maxHeight: 720, above: false });
});
