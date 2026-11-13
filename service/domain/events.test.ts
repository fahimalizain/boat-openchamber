import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eventRows, mergeEventRows, normalizeEvent } from './events.ts';

const CONVERSATION = 'e25e7685-e730-416e-a89c-1a1495f8cf89';

/** Real `boat events --json` lines. */
const PROMPT_LINE = '{"data":{"conversationId":"e25e7685-e730-416e-a89c-1a1495f8cf89","data":{"is_reverted":false,"prompt":"hii","status":"finished"},"id":"024babd7-9df6-4081-a066-88e6c28f6918","taskId":"b3006eba-a6c9-4b5a-85d3-49527603f039","timestamp":1794543555068,"type":"prompt"},"event":"chat","final":true}';
const RESPONSE_LINE = '{"data":{"conversationId":"e25e7685-e730-416e-a89c-1a1495f8cf89","data":{"content":"Hi! I\'m in the `devine-premier-uae` repo on `master`, and the working tree is clean. What would you like to work on?","is_reverted":false,"model":"claude-opus-5-5"},"id":"339f4612-36d9-41c3-9cc4-52db52f631ef","taskId":"b3006eba-a6c9-4b5a-85d3-49527603f039","timestamp":1794543556988,"type":"response"},"event":"chat","final":true}';

test('the chat envelope is unwrapped into prompt and response events', () => {
  const events = mergeEventRows([JSON.parse(PROMPT_LINE), JSON.parse(RESPONSE_LINE)], CONVERSATION);

  assert.equal(events.length, 2);
  const [prompt, response] = events;
  assert.equal(prompt?.id, '024babd7-9df6-4081-a066-88e6c28f6918');
  assert.equal(prompt?.type, 'prompt');
  assert.equal(prompt?.role, 'user');
  assert.equal(prompt?.text, 'hii');
  assert.equal(prompt?.status, 'finished');
  assert.equal(prompt?.conversationId, CONVERSATION);
  assert.equal(prompt?.at, 1_794_543_555_068);

  assert.equal(response?.role, 'assistant');
  assert.equal(response?.model, 'claude-opus-5-5');
  assert.match(response?.text ?? '', /Hi! I'm in the/);
  assert.equal(response?.streaming, false);
});

test('a partial response and its final collapse by id', () => {
  const final = JSON.parse(RESPONSE_LINE);
  const partial = JSON.parse(RESPONSE_LINE);
  partial.final = false;
  partial.data.data.content = 'Hi!';

  const merged = mergeEventRows([partial, final], CONVERSATION);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.streaming, false);
  assert.match(merged[0]?.text ?? '', /Hi! I'm in the/);

  const alone = normalizeEvent(partial, CONVERSATION);
  assert.equal(alone?.streaming, true);
  assert.equal(alone?.text, 'Hi!');
});

test('a flat event line still parses', () => {
  const event = normalizeEvent({
    id: 'e1',
    type: 'response',
    timestamp: 1_700_000_000_000,
    conversationId: CONVERSATION,
    data: { content: 'flat', model: 'm' },
  });
  assert.equal(event?.text, 'flat');
  assert.equal(event?.role, 'assistant');
});

test('a single JSONL line parsed as one object still yields an event', () => {
  const events = mergeEventRows(eventRows(JSON.parse(PROMPT_LINE)), CONVERSATION);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.text, 'hii');
});
