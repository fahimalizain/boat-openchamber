import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  OpencodeMessage,
  OpencodeModelRef,
  OpencodePermissionRequest,
  OpencodeQuestionRequest,
  OpencodeSession,
  OpencodeStreamEvent,
} from '../shared/opencode.ts';
import {
  applyChatEvent,
  applyChatEvents,
  applySessionEvents,
  createChatModel,
  withoutPermission,
} from './chat-model.ts';

const session = (overrides: Partial<OpencodeSession> = {}): OpencodeSession => ({
  id: 'ses_abc123',
  title: 'Fix the login page',
  directory: '/home/user/app',
  projectID: 'prj_1',
  agent: 'build',
  model: { id: 'big', providerID: 'acme', variant: null },
  createdAt: 1_000,
  updatedAt: 2_000,
  busyAt: null,
  idleAt: 2_000,
  archived: false,
  outcome: null,
  status: 'idle',
  cost: 0,
  ...overrides,
});

const model: OpencodeModelRef = { id: 'big', providerID: 'acme', variant: null };
const tokens = { input: 10, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 };

const stepEvent = (phase: 'started' | 'ended', overrides: Partial<Extract<OpencodeStreamEvent, { type: 'step' }>> = {}): OpencodeStreamEvent => ({
  type: 'step',
  sessionID: 'ses_abc123',
  messageID: 'msg_reply',
  phase,
  agent: phase === 'started' ? 'build' : null,
  model: phase === 'started' ? model : null,
  finish: phase === 'ended' ? 'stop' : null,
  cost: phase === 'ended' ? 0.02 : null,
  tokens: phase === 'ended' ? tokens : null,
  error: null,
  ...overrides,
});

const empty = () => createChatModel({ session: session(), messages: [] });

const onlyMessage = (chat: ReturnType<typeof empty>): OpencodeMessage => {
  assert.equal(chat.messages.length, 1);
  return chat.messages[0]!;
};

test('a prompt stream builds one assistant message with its text', () => {
  const chat = applyChatEvents(empty(), [
    { type: 'status', sessionID: 'ses_abc123', status: 'busy', error: null },
    stepEvent('started'),
    { type: 'part-start', sessionID: 'ses_abc123', messageID: 'msg_reply', part: 'text', ordinal: 0 },
    { type: 'delta', sessionID: 'ses_abc123', messageID: 'msg_reply', part: 'text', ordinal: 0, delta: 'Hel' },
    { type: 'delta', sessionID: 'ses_abc123', messageID: 'msg_reply', part: 'text', ordinal: 0, delta: 'lo' },
    stepEvent('ended'),
  ]);

  const message = onlyMessage(chat);
  assert.equal(message.role, 'assistant');
  assert.equal(message.agent, 'build');
  assert.deepEqual(message.model, model);
  assert.equal(message.parts.length, 1);
  assert.deepEqual(message.parts[0], { kind: 'text', ordinal: 0, text: 'Hello' });
  assert.equal(message.streaming, false);
  assert.equal(message.step?.finish, 'stop');
  assert.equal(message.step?.cost, 0.02);
  assert.equal(chat.session.status, 'busy');
});

test('an idle status stops a streaming message and records the idle time', () => {
  const chat = applyChatEvents(empty(), [
    { type: 'delta', sessionID: 'ses_abc123', messageID: 'msg_reply', part: 'text', ordinal: 0, delta: 'Done' },
    { type: 'status', sessionID: 'ses_abc123', status: 'idle', error: null },
  ]);

  assert.equal(onlyMessage(chat).streaming, false);
  assert.ok(onlyMessage(chat).completedAt);
  assert.equal(chat.session.status, 'idle');
  assert.ok(chat.session.idleAt);
});

test('tool events upsert by tool id, then carry input, progress and the clipped result', () => {
  const chat = applyChatEvents(empty(), [
    { type: 'tool-start', sessionID: 'ses_abc123', messageID: 'msg_reply', toolID: 'tool_1', name: 'bash' },
    { type: 'tool-input-delta', sessionID: 'ses_abc123', messageID: 'msg_reply', toolID: 'tool_1', delta: '{"command"' },
    { type: 'tool-input', sessionID: 'ses_abc123', messageID: 'msg_reply', toolID: 'tool_1', text: '{"command":"npm test"}' },
    { type: 'tool-called', sessionID: 'ses_abc123', messageID: 'msg_reply', toolID: 'tool_1', input: { command: 'npm test' }, executed: true },
    { type: 'tool-progress', sessionID: 'ses_abc123', messageID: 'msg_reply', toolID: 'tool_1', metadata: { lines: 4 } },
    {
      type: 'tool-result',
      sessionID: 'ses_abc123',
      messageID: 'msg_reply',
      toolID: 'tool_1',
      status: 'completed',
      output: 'all good',
      files: [],
      error: null,
      metadata: { exit: 0 },
      executed: true,
      truncated: true,
    },
  ]);

  const message = onlyMessage(chat);
  assert.equal(message.parts.length, 1);
  const part = message.parts[0];
  assert.equal(part?.kind, 'tool');
  if (part?.kind !== 'tool') return;
  assert.equal(part.tool.id, 'tool_1');
  assert.equal(part.tool.name, 'bash');
  assert.deepEqual(part.tool.input, { command: 'npm test' });
  assert.equal(part.tool.status, 'completed');
  assert.equal(part.tool.output, 'all good');
  assert.equal(part.tool.truncated, true);
  assert.deepEqual(part.tool.metadata, { exit: 0, lines: 4 });
  assert.ok(part.tool.completedAt);
});

test('reasoning parts stay separate from text and message-content replaces the parts', () => {
  const withDelta = applyChatEvents(empty(), [
    { type: 'part-start', sessionID: 'ses_abc123', messageID: 'msg_reply', part: 'reasoning', ordinal: 0 },
    { type: 'delta', sessionID: 'ses_abc123', messageID: 'msg_reply', part: 'reasoning', ordinal: 0, delta: 'Think' },
    { type: 'delta', sessionID: 'ses_abc123', messageID: 'msg_reply', part: 'text', ordinal: 1, delta: 'Answer' },
  ]);
  assert.deepEqual(withDelta.messages[0]?.parts.map((part) => part.kind), ['reasoning', 'text']);

  const replaced = applyChatEvent(withDelta, {
    type: 'message-content',
    sessionID: 'ses_abc123',
    messageID: 'msg_reply',
    parts: [{ kind: 'text', ordinal: 0, text: 'Final answer' }],
  });
  assert.deepEqual(replaced.messages[0]?.parts, [{ kind: 'text', ordinal: 0, text: 'Final answer' }]);
});

test('a todo part feeds message.todos', () => {
  const chat = applyChatEvent(empty(), {
    type: 'part',
    sessionID: 'ses_abc123',
    messageID: 'msg_reply',
    part: {
      kind: 'todo',
      todos: [
        { content: 'Write the test', status: 'completed', priority: 'high' },
        { content: 'Run it', status: 'in_progress', priority: null },
      ],
    },
  });
  assert.equal(chat.messages[0]?.todos.length, 2);
  assert.equal(chat.messages[0]?.todos[1]?.status, 'in_progress');
});

test('events for another session leave the chat alone', () => {
  const chat = empty();
  const next = applyChatEvent(chat, {
    type: 'delta',
    sessionID: 'ses_other',
    messageID: 'msg_reply',
    part: 'text',
    ordinal: 0,
    delta: 'nope',
  });
  assert.equal(next, chat);
});

test('permissions and questions arrive and clear', () => {
  const request: OpencodePermissionRequest = {
    id: 'per_1',
    sessionID: 'ses_abc123',
    action: 'bash',
    resources: ['npm test'],
    save: [],
    message: 'Run the tests?',
    source: 'bash',
    agent: 'build',
  };
  const question: OpencodeQuestionRequest = {
    id: 'frm_1',
    sessionID: 'ses_abc123',
    title: 'Which suite?',
    fields: [],
    metadata: null,
  };

  let chat = applyChatEvents(empty(), [
    { type: 'permission', request },
    { type: 'question', request: question },
  ]);
  assert.equal(chat.permissions.length, 1);
  assert.equal(chat.questions.length, 1);

  chat = applyChatEvent(chat, {
    type: 'permission-replied',
    sessionID: 'ses_abc123',
    requestID: 'per_1',
    reply: 'once',
  });
  chat = applyChatEvent(chat, { type: 'question-replied', sessionID: 'ses_abc123', questionID: 'frm_1' });
  assert.equal(chat.permissions.length, 0);
  assert.equal(chat.questions.length, 0);
  assert.equal(withoutPermission(chat, 'per_1'), chat);
});

test('the session list reducer adds, renames, marks and removes sessions', () => {
  const created = session({ id: 'ses_new', title: null, updatedAt: 5_000 });
  let list = applySessionEvents([session()], [{ type: 'session-created', session: created }]);
  assert.deepEqual(list.map((entry) => entry.id), ['ses_new', 'ses_abc123']);

  list = applySessionEvents(list, [
    { type: 'session-updated', sessionID: 'ses_new', title: 'Named later', directory: '/repo' },
    { type: 'status', sessionID: 'ses_new', status: 'busy', error: null },
  ]);
  assert.equal(list[0]?.title, 'Named later');
  assert.equal(list[0]?.directory, '/repo');
  assert.equal(list[0]?.status, 'busy');
  assert.ok(list[0]?.busyAt);

  list = applySessionEvents(list, [{ type: 'session-deleted', sessionID: 'ses_new' }]);
  assert.deepEqual(list.map((entry) => entry.id), ['ses_abc123']);
});
