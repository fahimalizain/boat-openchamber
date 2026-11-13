import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { OpencodeSession } from '../../shared/opencode.ts';
import type { Sandbox } from '../../shared/types.ts';
import {
  mentionRows,
  mentionSessionId,
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

const session = (overrides: Partial<OpencodeSession> = {}): OpencodeSession => ({
  id: 'ses_abc123',
  title: 'Fix the tests',
  directory: '/home/user/app',
  projectID: null,
  agent: 'build',
  model: { id: 'claude-sonnet-5', providerID: 'anthropic', variant: null },
  createdAt: 1_000,
  updatedAt: Date.now() - 120_000,
  busyAt: null,
  idleAt: null,
  archived: false,
  outcome: null,
  status: 'idle',
  cost: 0,
  ...overrides,
});

test('rows cover cached sessions, then the sandbox overview', () => {
  const alpha = sandbox();
  const rows = mentionRows({
    sandboxes: [alpha],
    sessions: () => [session()],
    projectIds: null,
    query: '',
  });

  assert.deepEqual(rows.map((row) => row.id), [
    mentionSessionId(alpha.id, 'ses_abc123'),
    `sandbox:${alpha.id}`,
  ]);
  assert.equal(rows[0]?.title, 'Fix the tests');
  assert.match(rows[0]?.subtitle ?? '', /Alpha · build\/claude-sonnet-5 · idle · 2m ago/);
  assert.equal(rows[1]?.title, 'Sandbox overview');
});

test('an untitled session is called new and long text is trimmed', () => {
  const rows = mentionRows({
    sandboxes: [sandbox()],
    sessions: () => [session({ title: null })],
    projectIds: null,
    query: '',
  });
  assert.equal(rows[0]?.title, 'New session');

  const long = mentionRows({
    sandboxes: [sandbox()],
    sessions: () => [session({ title: 'x'.repeat(200) })],
    projectIds: null,
    query: '',
  });
  assert.equal(long[0]?.title.length, 120);
  assert.match(long[0]?.title ?? '', /…$/);
});

test('the query filters on title, subtitle and ids', () => {
  const rows = mentionRows({
    sandboxes: [sandbox()],
    sessions: () => [session()],
    projectIds: null,
    query: 'SONNET',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, 'Fix the tests');

  const none = mentionRows({
    sandboxes: [sandbox()],
    sessions: () => [session()],
    projectIds: null,
    query: 'nothing like this',
  });
  assert.deepEqual(none, []);
});

test('project sandboxes rank first and sessions can be absent', () => {
  const other = sandbox({ id: 'bx_other01', name: 'Zulu' });
  const project = sandbox({ id: 'bx_proj001', name: 'Alpha' });
  const rows = mentionRows({
    sandboxes: [other, project],
    sessions: () => null,
    projectIds: new Set([project.id]),
    query: '',
  });
  assert.equal(rows[0]?.id, `sandbox:${project.id}`);
});

test('a busy session comes before a newer idle one', () => {
  const rows = mentionRows({
    sandboxes: [sandbox()],
    sessions: () => [
      session({ id: 'ses_idle01', title: 'Idle', updatedAt: Date.now() }),
      session({ id: 'ses_busy01', title: 'Busy', updatedAt: Date.now() - 600_000, status: 'busy' }),
    ],
    projectIds: null,
    query: '',
  });
  assert.equal(rows[0]?.title, 'Busy');
});

test('rows stop at twenty', () => {
  const many = Array.from({ length: 15 }, (_, index) => session({ id: `ses_many${index}` }));
  const rows = mentionRows({
    sandboxes: [sandbox({ id: 'bx_alpha01' }), sandbox({ id: 'bx_beta001', name: 'Beta' })],
    sessions: () => many,
    projectIds: null,
    query: '',
  });
  assert.equal(rows.length, 20);
});

test('parseMentionId accepts only our two shapes', () => {
  assert.deepEqual(parseMentionId('sandbox:bx_alpha01'), { kind: 'sandbox', sandboxId: 'bx_alpha01' });
  assert.deepEqual(parseMentionId('session:bx_alpha01:ses_abc123'), {
    kind: 'session',
    sandboxId: 'bx_alpha01',
    sessionId: 'ses_abc123',
  });
  assert.equal(parseMentionId('sandbox:../../etc'), null);
  assert.equal(parseMentionId('session:bx_alpha01:not a convo'), null);
  assert.equal(parseMentionId('conversation:bx_alpha01:8f1c2b7a-3d4e-4f5a-9b0c-1d2e3f4a5b6c'), null);
  assert.equal(parseMentionId(null), null);
});
