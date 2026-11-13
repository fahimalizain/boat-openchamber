import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Sandbox } from '../../shared/types.ts';
import { buildProjectMark, changedMarks, sameMark, type ProjectMark } from './mark.ts';

const sandbox = (overrides: Partial<Sandbox> = {}): Sandbox => ({
  id: 'bx_alpha01',
  name: 'Alpha',
  state: 'stopped',
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

test('a project with no sandboxes has no mark', () => {
  assert.equal(buildProjectMark([], new Set()), null);
});

test('the mark counts sandboxes, names running agents and takes its tone from the state', () => {
  const mark = buildProjectMark([sandbox()], new Set());
  assert.equal(mark?.icon, 'anchor');
  assert.equal(mark?.tone, 'info');
  assert.equal(mark?.text, '1 sandbox');

  const up = buildProjectMark([sandbox({ state: 'idle' }), sandbox({ id: 'bx_beta001', name: 'Beta' })], new Set());
  assert.equal(up?.tone, 'success');
  assert.equal(up?.text, '2 sandboxes');

  const busy = buildProjectMark(
    [sandbox({ state: 'idle' }), sandbox({ id: 'bx_beta001' })],
    new Set(['bx_alpha01']),
  );
  assert.equal(busy?.tone, 'success');
  assert.equal(busy?.text, '2 sandboxes · 1 agent running');
});

test('sameMark compares the values, not the object', () => {
  const mark: ProjectMark = { icon: 'anchor', tone: 'info', text: '1 sandbox' };
  assert.equal(sameMark(mark, { ...mark }), true);
  assert.equal(sameMark(mark, { ...mark, text: '2 sandboxes' }), false);
  assert.equal(sameMark(null, null), true);
  assert.equal(sameMark(mark, null), false);
});

test('the diff only reports changed, new and removed marks', () => {
  const info: ProjectMark = { icon: 'anchor', tone: 'info', text: '1 sandbox' };
  const success: ProjectMark = { icon: 'anchor', tone: 'success', text: '1 sandbox' };

  assert.deepEqual(changedMarks(new Map(), new Map()), []);
  assert.deepEqual(
    changedMarks(new Map([['/a', info]]), new Map([['/a', { ...info }]])),
    [],
  );
  assert.deepEqual(
    changedMarks(new Map([['/a', info]]), new Map([['/a', success]])),
    [{ directory: '/a', mark: success }],
  );
  assert.deepEqual(
    changedMarks(new Map([['/a', info]]), new Map()),
    [{ directory: '/a', mark: null }],
  );
});
