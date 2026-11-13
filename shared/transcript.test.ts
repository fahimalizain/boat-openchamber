import assert from 'node:assert/strict';
import { test } from 'node:test';

import { markdownTranscript, transcriptEntries } from './transcript.ts';
import type { UiEvent } from './types.ts';

const event = (overrides: Partial<UiEvent> = {}): UiEvent => ({
  id: 'e1',
  type: 'response',
  role: 'assistant',
  at: 1_700_000_000_000,
  text: '',
  streaming: false,
  model: 'claude',
  status: null,
  tools: [],
  error: null,
  conversationId: 'c1',
  ...overrides,
});

test('entries sort by time and name the speaker', () => {
  const entries = transcriptEntries([
    event({ id: 'b', at: 2, text: 'second' }),
    event({ id: 'a', at: 1, role: 'user', type: 'prompt', text: 'first' }),
  ]);
  assert.deepEqual(entries.map((entry) => entry.id), ['a', 'b']);
  assert.equal(entries[0]?.speaker, 'you');
  assert.equal(entries[1]?.speaker, 'claude');
});

test('markdown keeps each tool on one line and marks errors', () => {
  const entries = transcriptEntries([
    event({ id: 'a', role: 'user', type: 'prompt', text: 'run the tests' }),
    event({
      id: 'b',
      tools: [{ name: 'Bash', detail: 'npm\n  test', isError: true }],
      error: 'boom',
    }),
  ]);
  const { text, truncated } = markdownTranscript(entries, 10_000);

  assert.equal(truncated, false);
  assert.match(text, /\*\*You\*\*/);
  assert.match(text, /- `Bash` npm test \(error\)/);
  assert.match(text, /\*\*Error:\*\* boom/);
});

test('truncation keeps the newest turns and says so', () => {
  const entries = transcriptEntries([
    event({ id: 'a', text: 'A'.repeat(200) }),
    event({ id: 'b', text: 'B'.repeat(200) }),
    event({ id: 'c', text: 'C'.repeat(200) }),
  ]);
  const { text, truncated } = markdownTranscript(entries, 500);

  assert.equal(truncated, true);
  assert.match(text, /Older turns were left out/);
  assert.match(text, /C{200}/);
  assert.doesNotMatch(text, /A{200}/);
});

test('a single oversized turn is cut rather than dropped', () => {
  const entries = transcriptEntries([event({ id: 'a', text: 'Z'.repeat(2_000) })]);
  const { text, truncated } = markdownTranscript(entries, 300);

  assert.equal(truncated, true);
  assert.match(text, /Z{100,}/);
  assert.ok(text.length < 400);
});
