import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PlanLimits } from '../domain/limits.ts';
import { limitsBlockedReason, readCreateRequest } from './request.ts';

const limits = (overrides: Partial<PlanLimits> = {}): PlanLimits => ({
  canStart: true,
  blockedReason: null,
  active: 1,
  maxActive: 2,
  autoStopMaxHours: 2,
  sizes: [],
  ...overrides,
});

test('a clean machine keeps its environment, size, name and TTL', () => {
  const result = readCreateRequest({
    start: { kind: 'clean' },
    environment: 'web',
    size: 'large',
    name: 'web 2026-11-13',
    autoStopHours: 2,
  }, 2);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.input, {
    start: { kind: 'clean' },
    environment: 'web',
    size: 'large',
    name: 'web 2026-11-13',
    autoStopSeconds: 7_200,
  });
});

test('a snapshot start keeps its name and may carry an environment', () => {
  const result = readCreateRequest({
    start: { kind: 'snapshot', name: 'worker-base' },
    environment: 'web',
    autoStopHours: 1,
  }, 2);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.input.start, { kind: 'snapshot', name: 'worker-base' });
  assert.equal(result.ok && result.input.environment, 'web');
});

test('a copy start carries the sandbox and its name for the rename', () => {
  const result = readCreateRequest({
    start: { kind: 'copy', sandboxId: 'bx_7ppmwt9v' },
    name: 'Box copy',
    autoStopHours: 1,
  }, 2);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.input.start, { kind: 'copy', sandboxId: 'bx_7ppmwt9v' });
  assert.equal(result.ok && result.input.environment, undefined);
  assert.equal(result.ok && result.input.size, undefined);
  assert.equal(result.ok && result.input.name, 'Box copy');
});

test('the start is required and each kind validates its target', () => {
  assert.equal(readCreateRequest(null, 2).ok, false);
  assert.equal(readCreateRequest({ start: { kind: 'nope' as never } }, 2).ok, false);
  assert.equal(readCreateRequest({ start: { kind: 'snapshot', name: '' } }, 2).ok, false);
  assert.equal(readCreateRequest({ start: { kind: 'copy', sandboxId: '../../etc' } }, 2).ok, false);
  assert.equal(readCreateRequest({ start: { kind: 'copy', sandboxId: 'bx_7ppmwt9v' } }, 2).ok, true);
});

test('sizes, names and hours are validated', () => {
  assert.equal(
    readCreateRequest({ start: { kind: 'clean' }, size: 'huge' as never }, 2).ok,
    false,
  );
  assert.equal(
    readCreateRequest({ start: { kind: 'clean' }, name: 'x'.repeat(121) }, 2).ok,
    false,
  );
  assert.equal(readCreateRequest({ start: { kind: 'clean' }, autoStopHours: 0 }, 2).ok, false);
  assert.equal(readCreateRequest({ start: { kind: 'clean' }, autoStopHours: 3 }, 2).ok, false);
  assert.equal(readCreateRequest({ start: { kind: 'clean' }, autoStopHours: 1.5 }, 2).ok, false);
  assert.equal(readCreateRequest({ start: { kind: 'clean' }, autoStopHours: 2 }, 2).ok, true);
});

test('the plan blocks creating when it says so or the slots are full', () => {
  assert.equal(limitsBlockedReason(limits()), null);
  assert.equal(
    limitsBlockedReason(limits({ canStart: false, blockedReason: 'Payment method needed.' })),
    'Payment method needed.',
  );
  assert.equal(
    limitsBlockedReason(limits({ active: 2, maxActive: 2 })),
    'All 2 sandbox slots are in use. Stop one first.',
  );
});
