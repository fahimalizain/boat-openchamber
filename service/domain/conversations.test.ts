import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseConversationRows, conversationRows } from './conversations.ts';

/** A real `boat conversations --json` line. */
const LINE = '{"data":{"createdAt":"2026-11-13T04:19:14.823Z","current":true,"id":"e25e7685-e730-416e-a89c-1a1495f8cf89","lastHarness":"claude-code","lastModel":"opus-5-5","lastPromptAt":"2026-11-13T04:19:14.823Z","lastPromptPreview":"hii","prompts":1,"running":false,"shellCurrent":false},"event":"conversation"}';

test('the CLI envelope is unwrapped into a conversation', () => {
  const [conversation] = parseConversationRows([JSON.parse(LINE)]);

  assert.equal(conversation?.id, 'e25e7685-e730-416e-a89c-1a1495f8cf89');
  assert.equal(conversation?.lastHarness, 'claude-code');
  assert.equal(conversation?.lastModel, 'opus-5-5');
  assert.equal(conversation?.lastPromptPreview, 'hii');
  assert.equal(conversation?.prompts, 1);
  assert.equal(conversation?.running, false);
  assert.equal(conversation?.current, true);
});

test('a flat conversation line still parses', () => {
  const [conversation] = parseConversationRows([{
    id: 'c1',
    lastHarness: 'claude-code',
    lastModel: 'opus-5-5',
    running: true,
  }]);
  assert.equal(conversation?.id, 'c1');
  assert.equal(conversation?.running, true);
});

test('lines without an id are ignored', () => {
  assert.deepEqual(parseConversationRows([{ event: 'conversation', data: {} }]), []);
});

test('a single JSONL line parsed as one object still yields a row', () => {
  const [conversation] = parseConversationRows(conversationRows(JSON.parse(LINE)));
  assert.equal(conversation?.id, 'e25e7685-e730-416e-a89c-1a1495f8cf89');
  assert.equal(conversation?.lastHarness, 'claude-code');
});
