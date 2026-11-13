import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { OpencodeInboxEntry } from '../shared/opencode.ts';
import {
  deliveryFor,
  deliveryLabel,
  inboxFilesLabel,
  inboxLabel,
  inboxSignature,
  inboxSummary,
  toggledDelivery,
  withInboxDelivery,
  withoutInbox,
} from './inbox.ts';

const entry = (overrides: Partial<OpencodeInboxEntry> = {}): OpencodeInboxEntry => ({
  id: 'msg_1',
  sessionID: 'ses_1',
  text: 'Look at the deploy log',
  delivery: 'steer',
  createdAt: 0,
  files: [],
  type: 'user',
  ...overrides,
});

test('a delivery reads as a steer or a queue, and toggles to the other', () => {
  assert.equal(deliveryLabel('steer'), 'steer');
  assert.equal(deliveryLabel('queue'), 'queued');
  assert.equal(toggledDelivery('steer'), 'queue');
  assert.equal(toggledDelivery('queue'), 'steer');
});

test('an idle send has no delivery; a busy one steers unless told otherwise', () => {
  assert.equal(deliveryFor(false), null);
  assert.equal(deliveryFor(false, 'queue'), null);
  assert.equal(deliveryFor(true), 'steer');
  assert.equal(deliveryFor(true, 'steer'), 'steer');
  assert.equal(deliveryFor(true, 'queue'), 'queue');
});

test('a row shows one line of text, or what the entry is', () => {
  assert.equal(inboxLabel(entry()), 'Look at the deploy log');
  assert.equal(inboxLabel(entry({ text: '  two\n\nlines  ' })), 'two lines');
  assert.equal(inboxLabel(entry({ text: '', type: 'compaction' })), 'Compact the conversation');
  assert.equal(inboxLabel(entry({ text: '', type: 'synthetic' })), 'A system prompt');
  assert.equal(inboxLabel(entry({ text: '', type: 'move' })), 'Move the session');
  assert.equal(inboxLabel(entry({ text: '', type: 'user' })), 'A prompt');
});

test('attachments add their count after the text', () => {
  const file = { name: 'shot.png', mime: 'image/png', uri: null };
  assert.equal(inboxFilesLabel(entry()), null);
  assert.equal(inboxFilesLabel(entry({ files: [file] })), '1 image');
  assert.equal(inboxFilesLabel(entry({ files: [file, file] })), '2 images');
  assert.equal(inboxSummary(entry({ files: [file] })), 'Look at the deploy log · 1 image');
});

test('cancelling drops one row and leaves the rest untouched', () => {
  const first = entry();
  const second = entry({ id: 'msg_2', delivery: 'queue' });
  const entries = [first, second];

  assert.equal(withoutInbox(entries, 'missing'), entries);
  assert.deepEqual(withoutInbox(entries, 'msg_1'), [second]);
  assert.equal(entries.length, 2);
});

test('switching delivery re-flags one row without touching the others', () => {
  const first = entry();
  const second = entry({ id: 'msg_2', delivery: 'queue' });
  const entries = [first, second];

  const next = withInboxDelivery(entries, 'msg_1', 'queue');
  assert.deepEqual(next.map((row) => row.delivery), ['queue', 'queue']);
  assert.equal(next[1], second);
  assert.equal(entries[0]?.delivery, 'steer');
  assert.equal(withInboxDelivery(entries, 'msg_1', 'steer'), entries);
  assert.equal(withInboxDelivery(entries, 'missing', 'queue'), entries);
});

test('the row signature carries ids and deliveries only', () => {
  assert.equal(inboxSignature([]), '');
  assert.equal(inboxSignature([entry(), entry({ id: 'msg_2', delivery: 'queue' })]), 'msg_1:steer,msg_2:queue');
  assert.equal(
    inboxSignature([entry({ text: 'changed text' })]),
    inboxSignature([entry()]),
  );
});
