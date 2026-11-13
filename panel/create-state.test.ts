import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CreateOptionsResponse } from '../shared/routes.ts';
import type { SandboxSummary } from '../shared/types.ts';
import {
  blockedReason,
  createRequest,
  defaultForm,
  environmentOptions,
  formatBytes,
  hoursMax,
  sizeOptions,
  snapshotHint,
  startOptions,
  type CreateForm,
} from './create-state.ts';

const options = (overrides: Partial<CreateOptionsResponse> = {}): CreateOptionsResponse => ({
  environments: [
    { name: 'base', isDefault: true },
    { name: 'web', isDefault: false },
  ],
  snapshots: [{
    name: 'worker-base',
    type: 'default',
    createdAt: '2026-11-13T03:43:16.410Z',
    sizeBytes: 1_879_261_184,
  }],
  limits: {
    canStart: true,
    reason: null,
    active: 1,
    maxActive: 2,
    autoStopMaxHours: 2,
    sizes: [
      { id: 'small', available: true, reason: null },
      { id: 'default', available: true, reason: null },
      { id: 'large', available: true, reason: null },
      { id: 'xlarge', available: false, reason: 'needs the $100/month plan or higher' },
    ],
  },
  suggestedEnvironment: 'web',
  ...overrides,
});

const sandbox = (overrides: Partial<SandboxSummary> = {}): SandboxSummary => ({
  id: 'bx_source01',
  name: 'Worker',
  state: 'stopped',
  type: 'default',
  vcpu: 4,
  memoryGB: 8,
  environment: 'base',
  ttlSeconds: 3600,
  archiveAfter: null,
  stoppedAt: null,
  desktopAvailable: true,
  ...overrides,
});

const form = (overrides: Partial<CreateForm> = {}): CreateForm => ({
  start: 'clean',
  snapshot: 'worker-base',
  copyFrom: null,
  environment: 'web',
  size: 'default',
  name: '',
  autoStopHours: 1,
  ...overrides,
});

test('defaults: a clean machine, the project environment, the project name', () => {
  const defaults = defaultForm(options(), '/Users/me/projects/My App', Date.UTC(2026, 10, 13));

  assert.equal(defaults.start, 'clean');
  assert.equal(defaults.environment, 'web');
  assert.equal(defaults.size, 'default');
  assert.equal(defaults.name, 'My App 2026-11-13');
  assert.equal(defaults.snapshot, 'worker-base');
  assert.equal(hoursMax(options()), 2);
});

test('size labels carry their specs and snapshot hints carry size and date', () => {
  const sizes = sizeOptions(form(), options());
  assert.equal(sizes[0]?.label, 'Small · 2 vCPU, 4 GB');
  assert.equal(sizes[1]?.label, 'Default · 4 vCPU, 8 GB');
  assert.match(sizes[3]?.hint ?? '', /100\/month/);

  assert.equal(formatBytes(1_879_261_184), '1.8 GB');
  assert.equal(formatBytes(null), '');
  assert.equal(snapshotHint(options().snapshots[0]!), '1.8 GB · 2026-11-13');
});

test('the start choices note when nothing is saved or nothing can be copied', () => {
  const none = startOptions(options({ snapshots: [] }), []);
  assert.equal(none[1]?.hint, 'none saved yet');
  assert.equal(none[2]?.hint, 'none yet');
  assert.equal(startOptions(options(), [sandbox()])[1]?.hint, undefined);
});

test('a copy inherits the source environment, with the source named in the option', () => {
  const source = sandbox({ id: 'bx_source01', name: 'Worker', environment: 'base' });
  const choices = environmentOptions(form({ start: 'copy', copyFrom: source.id }), options(), [source]);
  assert.equal(choices[0]?.id, 'inherit');
  assert.equal(choices[0]?.label, 'Same as Worker (base)');
  assert.equal(choices[1]?.hint, 'default');
});

test('a copy offers the source size first', () => {
  const sizes = sizeOptions(form({ start: 'copy', size: null }), options());
  assert.equal(sizes[0]?.id, 'source');
  assert.equal(sizes[0]?.label, 'Same as source');
});

test('Create is blocked with a reason', () => {
  assert.equal(blockedReason(form(), options(), [sandbox()]), null);
  assert.match(blockedReason(form(), null, []) ?? '', /still loading/);
  assert.equal(
    blockedReason(form(), options({ limits: { ...options().limits, canStart: false, reason: 'No card.' } }), []),
    'No card.',
  );
  assert.match(
    blockedReason(form(), options({ limits: { ...options().limits, active: 2, maxActive: 2 } }), []) ?? '',
    /slots are in use/,
  );
  assert.match(
    blockedReason(form({ start: 'snapshot' }), options({ snapshots: [] }), []) ?? '',
    /boat snapshot/,
  );
  assert.match(blockedReason(form({ start: 'snapshot', snapshot: null }), options(), []) ?? '', /Pick a snapshot/);
  assert.match(blockedReason(form({ start: 'copy' }), options(), []) ?? '', /No sandbox to copy/);
  assert.match(blockedReason(form({ start: 'copy' }), options(), [sandbox()]) ?? '', /Pick a sandbox to copy/);
  assert.match(blockedReason(form({ environment: null }), options(), []) ?? '', /Pick an environment/);
  assert.match(
    blockedReason(form(), options({ environments: [] }), []) ?? '',
    /No environments were read/,
  );
  assert.match(blockedReason(form({ size: 'xlarge' }), options(), []) ?? '', /100\/month/);
  assert.match(blockedReason(form({ autoStopHours: 3 }), options(), []) ?? '', /capped at 2 hours/);
  assert.match(blockedReason(form({ autoStopHours: 0 }), options(), []) ?? '', /at least 1 hour/);
  assert.match(blockedReason(form({ name: 'x'.repeat(121) }), options(), []) ?? '', /too long/);
});

test('the request keeps undefined for inherited environment and size', () => {
  assert.deepEqual(createRequest(form({ name: ' Web ' })), {
    start: { kind: 'clean' },
    environment: 'web',
    size: 'default',
    name: 'Web',
    autoStopHours: 1,
  });

  assert.deepEqual(
    createRequest(form({
      start: 'copy',
      copyFrom: 'bx_source01',
      environment: null,
      size: null,
      name: 'Worker copy',
    })),
    {
      start: { kind: 'copy', sandboxId: 'bx_source01' },
      environment: undefined,
      size: undefined,
      name: 'Worker copy',
      autoStopHours: 1,
    },
  );

  assert.deepEqual(createRequest(form({ start: 'snapshot', snapshot: 'worker-base' })).start, {
    kind: 'snapshot',
    name: 'worker-base',
  });
});
