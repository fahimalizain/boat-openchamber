import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeAgent,
  normalizeAssistantContent,
  normalizeMessage,
  normalizeModel,
  normalizeModels,
  normalizePermissionRequest,
  normalizeQuestionRequest,
  normalizeSession,
  normalizeStreamEvent,
  normalizeTool,
  readModelRef,
  toModelRefInput,
} from './normalize.ts';

test('a session is busy, idle or in error from its execution timestamps', () => {
  const base = {
    id: 'ses_1',
    projectID: 'project_1',
    title: 'Greeting',
    agent: 'build',
    model: { id: 'gemini', providerID: 'opencode', variant: 'max' },
    cost: 0.25,
    location: { directory: '/home/user/app' },
  };

  assert.deepEqual(normalizeSession({
    ...base,
    time: { created: 100, updated: 300, busy: 250, idle: 200 },
    outcome: 'succeeded',
  }), {
    id: 'ses_1',
    title: 'Greeting',
    directory: '/home/user/app',
    projectID: 'project_1',
    agent: 'build',
    model: { id: 'gemini', providerID: 'opencode', variant: 'max' },
    createdAt: 100,
    updatedAt: 300,
    busyAt: 250,
    idleAt: 200,
    archived: false,
    outcome: 'succeeded',
    status: 'busy',
    cost: 0.25,
  });
  assert.equal(normalizeSession({ ...base, time: { created: 100, updated: 300, busy: 200, idle: 250 } })?.status, 'idle');
  assert.equal(normalizeSession({ ...base, time: { created: 100, updated: 300, busy: 100, idle: 300 }, outcome: 'failed' })?.status, 'error');
  assert.equal(normalizeSession({ ...base, time: { created: 100, updated: 300, archived: 350 } })?.archived, true);
  assert.equal(normalizeSession({ ...base, id: undefined, sessionID: 'ses_2' })?.id, 'ses_2');
  assert.equal(normalizeSession(null), null);
});

test('an assistant message keeps text, reasoning, tools, the patch and todos', () => {
  const message = normalizeMessage({
    id: 'msg_a',
    time: { created: 1_000, streamed: 1_900, completed: 2_000 },
    type: 'assistant',
    agent: 'build',
    model: { id: 'gemini', providerID: 'opencode', variant: 'max' },
    content: [
      { type: 'reasoning', text: 'think first', time: { created: 1_100, completed: 1_200 } },
      { type: 'text', text: 'the answer' },
      {
        type: 'tool',
        id: 'call_1',
        name: 'bash',
        executed: true,
        state: {
          status: 'completed',
          input: { command: 'ls' },
          content: [
            { type: 'text', text: 'a.txt' },
            { type: 'file', uri: 'file:///tmp/a.png', mime: 'image/png', name: 'a.png' },
          ],
          metadata: { exit: 0 },
        },
        time: { created: 1_300, completed: 1_400 },
      },
      {
        type: 'tool',
        id: 'call_2',
        name: 'todowrite',
        executed: true,
        state: {
          status: 'completed',
          input: { todos: [{ content: 'write tests', status: 'in_progress', priority: 'high' }] },
          content: [],
        },
        time: { created: 1_500 },
      },
    ],
    snapshot: { start: 'snap_1', end: 'snap_2', files: ['src/a.ts'] },
    finish: 'stop',
    cost: 0.5,
    tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
  }, 'ses_1');

  assert.ok(message);
  assert.equal(message.role, 'assistant');
  assert.equal(message.streaming, false);
  assert.equal(message.completedAt, 2_000);
  assert.deepEqual(message.parts.map((part) => part.kind), ['reasoning', 'text', 'tool', 'tool', 'todo', 'patch']);
  assert.deepEqual(message.todos, [{ content: 'write tests', status: 'in_progress', priority: 'high' }]);
  assert.deepEqual(message.patch, { start: 'snap_1', end: 'snap_2', files: ['src/a.ts'] });
  assert.deepEqual(message.step, {
    agent: 'build',
    model: { id: 'gemini', providerID: 'opencode', variant: 'max' },
    startedAt: 1_000,
    completedAt: 2_000,
    finish: 'stop',
    cost: 0.5,
    tokens: { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 },
  });

  const tool = message.parts[2];
  assert.ok(tool && tool.kind === 'tool');
  assert.equal(tool.tool.output, 'a.txt');
  assert.equal(tool.tool.error, null);
  assert.deepEqual(tool.tool.files, [{ name: 'a.png', mime: 'image/png', uri: 'file:///tmp/a.png' }]);
  assert.deepEqual(tool.tool.input, { command: 'ls' });
  assert.equal(tool.tool.status, 'completed');
});

test('a streaming tool keeps its partial input text', () => {
  const tool = normalizeTool({
    id: 'call_1',
    name: 'edit',
    state: { status: 'streaming', input: '{"file":"a' },
    time: { created: 1_000 },
  });
  assert.deepEqual(tool, {
    id: 'call_1',
    name: 'edit',
    status: 'streaming',
    input: null,
    inputText: '{"file":"a',
    output: null,
    error: null,
    files: [],
    metadata: null,
    executed: null,
    startedAt: 1_000,
    completedAt: null,
    truncated: false,
  });
});

test('a failed tool exposes the error and its content', () => {
  const tool = normalizeTool({
    id: 'call_2',
    name: 'bash',
    executed: true,
    state: {
      status: 'error',
      input: { command: 'false' },
      error: { type: 'exit', message: 'exited 1' },
      content: [{ type: 'text', text: 'nope' }],
    },
  });
  assert.equal(tool?.status, 'error');
  assert.equal(tool?.error, 'exited 1');
  assert.equal(tool?.output, 'nope');
});

test('a long tool output is clipped and marked truncated', () => {
  const tool = normalizeTool({
    id: 'call_3',
    name: 'read',
    state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'x'.repeat(25_000) }] },
  });
  assert.equal(tool?.truncated, true);
  assert.equal(tool?.output?.length, 20_000);
});

test('user attachments keep a reference, never the base64 bytes', () => {
  const message = normalizeMessage({
    id: 'msg_u',
    time: { created: 10 },
    type: 'user',
    text: 'look at these',
    files: [
      { data: 'AAAA', mime: 'image/png', source: { type: 'inline' }, name: 'inline.png' },
      { data: 'BBBB', mime: 'text/plain', source: { type: 'uri', uri: 'file:///notes.txt' }, name: 'notes.txt' },
    ],
  }, 'ses_1');

  assert.ok(message);
  assert.deepEqual(message.parts.map((part) => part.kind), ['text', 'file', 'file']);
  assert.deepEqual(message.files, [
    { name: 'inline.png', mime: 'image/png', uri: null },
    { name: 'notes.txt', mime: 'text/plain', uri: 'file:///notes.txt' },
  ]);
  assert.equal(JSON.stringify(message).includes('AAAA'), false);
});

test('idle, shell, compaction and switch messages become notices', () => {
  assert.equal(normalizeMessage({ id: 'msg_1', type: 'idle', outcome: 'failed', time: { created: 1 } }, 'ses_1')?.error, 'The turn failed.');
  assert.equal(normalizeMessage({ id: 'msg_1', type: 'idle', outcome: 'interrupted', time: { created: 1 } }, 'ses_1')?.notice, 'Interrupted.');

  const shell = normalizeMessage({
    id: 'msg_2',
    type: 'shell',
    time: { created: 1 },
    command: 'ls -la',
    status: 'exited',
    output: { output: 'a.txt', cursor: 5, size: 5, truncated: false },
  }, 'ses_1');
  assert.equal(shell?.notice, '$ ls -la');
  assert.deepEqual(shell?.parts, [{ kind: 'text', ordinal: -1, text: 'a.txt' }]);

  const compacted = normalizeMessage({
    id: 'msg_3',
    type: 'compaction',
    time: { created: 1 },
    status: 'completed',
    summary: 'a summary',
  }, 'ses_1');
  assert.equal(compacted?.notice, 'Compacted the conversation.');
  assert.deepEqual(compacted?.parts, [{ kind: 'text', ordinal: -1, text: 'a summary' }]);

  const switched = normalizeMessage({
    id: 'msg_4',
    type: 'model-switched',
    time: { created: 1 },
    model: { id: 'gpt', providerID: 'openai' },
  }, 'ses_1');
  assert.equal(switched?.notice, 'Model switched to openai/gpt.');
});

test('assistant content can be normalised without its message envelope', () => {
  const { parts, todos } = normalizeAssistantContent([
    { type: 'text', text: 'hello' },
    { type: 'tool', id: 'call_1', name: 'read', state: { status: 'running', input: { path: 'a' }, metadata: {} } },
  ]);
  assert.deepEqual(parts.map((part) => part.kind), ['text', 'tool']);
  assert.equal(parts[0]?.kind === 'text' ? parts[0].ordinal : null, 0);
  assert.deepEqual(todos, []);
});

test('permission requests and forms map to the panel shapes', () => {
  assert.deepEqual(normalizePermissionRequest({
    id: 'per_1',
    sessionID: 'ses_1',
    action: 'read',
    resources: ['.env'],
    save: ['read *.env'],
    source: { type: 'tool', messageID: 'msg_1', id: 'call_1' },
    message: 'Allow reading .env?',
    agent: 'build',
  }), {
    id: 'per_1',
    sessionID: 'ses_1',
    action: 'read',
    resources: ['.env'],
    save: ['read *.env'],
    message: 'Allow reading .env?',
    source: 'tool',
    agent: 'build',
  });

  const question = normalizeQuestionRequest({
    id: 'frm_1',
    sessionID: 'ses_1',
    title: 'Pick one',
    fields: [
      {
        key: 'choice',
        type: 'multiselect',
        title: 'Which?',
        required: true,
        options: [{ value: 'a', label: 'A', description: 'first' }],
        default: ['a'],
        minItems: 1,
      },
      { key: 'note', type: 'string', minLength: 2, default: 'hi' },
      { key: 'bad', type: 'nonsense' },
    ],
  });
  assert.equal(question?.title, 'Pick one');
  assert.equal(question?.fields.length, 2);
  assert.deepEqual(question?.fields[0], {
    key: 'choice',
    type: 'multiselect',
    title: 'Which?',
    description: null,
    required: true,
    hidden: false,
    options: [{ value: 'a', label: 'A', description: 'first' }],
    minLength: null,
    maxLength: null,
    min: null,
    max: null,
    minItems: 1,
    maxItems: null,
    default: ['a'],
    url: null,
  });
  assert.equal(question?.fields[1]?.default, 'hi');
});

test('agents, providers and models normalise for the pickers', () => {
  assert.deepEqual(normalizeAgent({
    id: 'build',
    name: 'Build',
    description: 'The default agent.',
    mode: 'primary',
    hidden: false,
    model: { id: 'gemini', providerID: 'opencode' },
  }), {
    id: 'build',
    name: 'Build',
    description: 'The default agent.',
    mode: 'primary',
    hidden: false,
    model: { id: 'gemini', providerID: 'opencode', variant: null },
  });

  assert.deepEqual(normalizeModel({
    id: 'gemini',
    providerID: 'opencode',
    name: 'Gemini',
    type: 'chat',
    variants: [{ id: 'low' }, { id: 'high' }],
    capabilities: { tools: true, input: ['text'], output: ['text'] },
    limit: { context: 1_000_000, output: 65_536 },
    enabled: true,
  }, 'OpenCode'), {
    id: 'gemini',
    providerID: 'opencode',
    providerName: 'OpenCode',
    name: 'Gemini',
    type: 'chat',
    variants: ['low', 'high'],
    reasoning: true,
    tools: true,
    contextLimit: 1_000_000,
    outputLimit: 65_536,
    enabled: true,
  });

  const models = normalizeModels([
    { id: 'a', providerID: 'p1', name: 'A' },
    { id: 'a', providerID: 'p2', name: 'A2' },
    { name: 'broken' },
  ], new Map([['p1', 'One']]));
  assert.deepEqual(models.map((model) => `${model.providerID}/${model.id}/${model.providerName}`), [
    'p1/a/One',
    'p2/a/p2',
  ]);
});

test('model refs round-trip and omit a null variant for the client', () => {
  assert.deepEqual(readModelRef({ id: 'gpt', providerID: 'openai' }), { id: 'gpt', providerID: 'openai', variant: null });
  assert.equal(readModelRef({ id: 'gpt' }), null);
  assert.deepEqual(toModelRefInput({ id: 'gpt', providerID: 'openai', variant: null }), { id: 'gpt', providerID: 'openai' });
  assert.deepEqual(toModelRefInput({ id: 'gpt', providerID: 'openai', variant: 'high' }), {
    id: 'gpt',
    providerID: 'openai',
    variant: 'high',
  });
});

test('stream events normalise the ones the chat renders', () => {
  assert.deepEqual(normalizeStreamEvent({
    id: 'evt_1',
    type: 'session.text.delta',
    created: 1,
    data: { sessionID: 'ses_1', assistantMessageID: 'msg_1', ordinal: 0, delta: 'hi' },
  }), {
    type: 'delta',
    sessionID: 'ses_1',
    messageID: 'msg_1',
    part: 'text',
    ordinal: 0,
    delta: 'hi',
  });

  assert.deepEqual(normalizeStreamEvent({
    id: 'evt_2',
    type: 'session.execution.failed',
    created: 1,
    data: { sessionID: 'ses_1', error: { type: 'provider', message: 'no key' } },
  }), {
    type: 'status',
    sessionID: 'ses_1',
    status: 'error',
    error: 'no key',
  });

  assert.deepEqual(normalizeStreamEvent({
    id: 'evt_3',
    type: 'session.tool.input.started',
    created: 1,
    data: { sessionID: 'ses_1', assistantMessageID: 'msg_1', id: 'call_1', name: 'bash' },
  }), {
    type: 'tool-start',
    sessionID: 'ses_1',
    messageID: 'msg_1',
    toolID: 'call_1',
    name: 'bash',
  });

  const success = normalizeStreamEvent({
    id: 'evt_4',
    type: 'session.tool.success',
    created: 1,
    data: {
      sessionID: 'ses_1',
      assistantMessageID: 'msg_1',
      id: 'call_1',
      executed: true,
      content: [{ type: 'text', text: 'done' }],
      metadata: { exit: 0 },
    },
  });
  assert.ok(success && success.type === 'tool-result');
  assert.equal(success.status, 'completed');
  assert.equal(success.output, 'done');
  assert.deepEqual(success.metadata, { exit: 0 });

  assert.deepEqual(normalizeStreamEvent({
    id: 'evt_5',
    type: 'permission.asked',
    created: 1,
    data: { id: 'per_1', sessionID: 'ses_1', action: 'read', resources: ['.env'] },
  }), {
    type: 'permission',
    request: {
      id: 'per_1',
      sessionID: 'ses_1',
      action: 'read',
      resources: ['.env'],
      save: [],
      message: null,
      source: null,
      agent: null,
    },
  });

  const question = normalizeStreamEvent({
    id: 'evt_6',
    type: 'form.created',
    created: 1,
    data: { form: { id: 'frm_1', sessionID: 'ses_1', title: 'Pick', fields: [{ key: 'a', type: 'string' }] } },
  });
  assert.equal(question?.type, 'question');

  const content = normalizeStreamEvent({
    id: 'evt_7',
    type: 'session.message.content.updated',
    created: 1,
    data: { sessionID: 'ses_1', messageID: 'msg_1', content: [{ type: 'text', text: 'final' }] },
  });
  assert.deepEqual(content, {
    type: 'message-content',
    sessionID: 'ses_1',
    messageID: 'msg_1',
    parts: [{ kind: 'text', ordinal: 0, text: 'final' }],
  });

  assert.deepEqual(normalizeStreamEvent({
    id: 'evt_8',
    type: 'session.created',
    created: 5,
    data: {
      sessionID: 'ses_1',
      projectID: 'p',
      title: 'New',
      location: { directory: '/home/user/app' },
    },
  }), {
    type: 'session-created',
    session: {
      id: 'ses_1',
      title: 'New',
      directory: '/home/user/app',
      projectID: 'p',
      agent: null,
      model: null,
      createdAt: 5,
      updatedAt: 5,
      busyAt: null,
      idleAt: null,
      archived: false,
      outcome: null,
      status: 'idle',
      cost: 0,
    },
  });

  assert.equal(normalizeStreamEvent({ id: 'evt_9', type: 'session.usage.updated', data: { sessionID: 'ses_1' } }), null);
  assert.equal(normalizeStreamEvent({ id: 'evt_10', type: 'server.connected', data: {} }), null);
  assert.equal(normalizeStreamEvent(null), null);
});
