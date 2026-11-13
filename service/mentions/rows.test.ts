import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Conversation, Sandbox } from '../../shared/types.ts';
import {
  mentionConversationId,
  mentionRows,
  parseMentionId,
} from './rows.ts';

const sandbox = (overrides: Partial<Sandbox> = {}): Sandbox => ({
  id: 'bx_alpha01',
  name: 'Alpha',
  state: 'idle',
  type: 'default',
  vcpu: 4,
  memoryGB: 8,
  createdAt: null,
  archiveAfter: null,
  stoppedAt: null,
  url: null,
  ttlSeconds: 3600,
  desktopAvailable: true,
  environment: 'base',
  health: 'ok',
  sshEndpoint: null,
  labels: {},
  ...overrides,
});

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: '8f1c2b7a-3d4e-4f5a-9b0c-1d2e3f4a5b6c',
  createdAt: null,
  lastPromptAt: new Date(Date.now() - 120_000).toISOString(),
  prompts: 1,
  running: false,
  lastHarness: 'claude',
  lastModel: 'claude-sonnet-5',
  lastPromptPreview: 'Fix the tests',
  current: true,
  ...overrides,
});

test('rows cover cached conversations, then the sandbox overview', () => {
  const alpha = sandbox();
  const rows = mentionRows({
    sandboxes: [alpha],
    conversations: () => [conversation()],
    projectIds: null,
    query: '',
  });

  assert.deepEqual(rows.map((row) => row.id), [
    mentionConversationId(alpha.id, '8f1c2b7a-3d4e-4f5a-9b0c-1d2e3f4a5b6c'),
    `sandbox:${alpha.id}`,
  ]);
  assert.equal(rows[0]?.title, 'Fix the tests');
  assert.match(rows[0]?.subtitle ?? '', /Alpha · claude\/claude-sonnet-5 · idle · 2m ago/);
  assert.equal(rows[1]?.title, 'Sandbox overview');
});

test('an empty conversation is called a new one and long text is trimmed', () => {
  const rows = mentionRows({
    sandboxes: [sandbox()],
    conversations: () => [conversation({ lastPromptPreview: null })],
    projectIds: null,
    query: '',
  });
  assert.equal(rows[0]?.title, 'New conversation');

  const long = mentionRows({
    sandboxes: [sandbox()],
    conversations: () => [conversation({ lastPromptPreview: 'x'.repeat(200) })],
    projectIds: null,
    query: '',
  });
  assert.equal(long[0]?.title.length, 120);
  assert.match(long[0]?.title ?? '', /…$/);
});

test('the query filters on title, subtitle and ids', () => {
  const rows = mentionRows({
    sandboxes: [sandbox()],
    conversations: () => [conversation()],
    projectIds: null,
    query: 'SONNET',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, 'Fix the tests');

  const none = mentionRows({
    sandboxes: [sandbox()],
    conversations: () => [conversation()],
    projectIds: null,
    query: 'nothing like this',
  });
  assert.deepEqual(none, []);
});

test('project sandboxes rank first and conversations can be absent', () => {
  const other = sandbox({ id: 'bx_other01', name: 'Zulu' });
  const project = sandbox({ id: 'bx_proj001', name: 'Alpha' });
  const rows = mentionRows({
    sandboxes: [other, project],
    conversations: () => null,
    projectIds: new Set([project.id]),
    query: '',
  });
  assert.equal(rows[0]?.id, `sandbox:${project.id}`);
});

test('rows stop at twenty', () => {
  const many = Array.from({ length: 15 }, (_, index) => conversation({ id: `conversation-${index}` }));
  const rows = mentionRows({
    sandboxes: [sandbox({ id: 'bx_alpha01' }), sandbox({ id: 'bx_beta001', name: 'Beta' })],
    conversations: () => many,
    projectIds: null,
    query: '',
  });
  assert.equal(rows.length, 20);
});

test('parseMentionId accepts only our two shapes', () => {
  assert.deepEqual(parseMentionId('sandbox:bx_alpha01'), { kind: 'sandbox', sandboxId: 'bx_alpha01' });
  assert.deepEqual(parseMentionId('conversation:bx_alpha01:8f1c2b7a-3d4e-4f5a-9b0c-1d2e3f4a5b6c'), {
    kind: 'conversation',
    sandboxId: 'bx_alpha01',
    conversationId: '8f1c2b7a-3d4e-4f5a-9b0c-1d2e3f4a5b6c',
  });
  assert.equal(parseMentionId('sandbox:../../etc'), null);
  assert.equal(parseMentionId('conversation:bx_alpha01:not a convo'), null);
  assert.equal(parseMentionId(null), null);
});
