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

test('an environment create carries its source, size, name and TTL', () => {
  const result = readCreateRequest({
    source: 'environment',
    environment: 'web',
    type: 'large',
    name: 'web 2026-11-13',
    autoStopHours: 2,
  }, 2);

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.input, {
    source: 'environment',
    environment: 'web',
    snapshot: undefined,
    fork: undefined,
    type: 'large',
    name: 'web 2026-11-13',
    autoStopSeconds: 7_200,
  });
});

test('each source needs its target', () => {
  assert.equal(readCreateRequest({ source: 'environment' }, 2).ok, false);
  assert.equal(readCreateRequest({ source: 'snapshot' }, 2).ok, false);
  assert.equal(readCreateRequest({ source: 'fork' }, 2).ok, false);
  assert.equal(readCreateRequest({ source: 'fork', fork: '../../etc' }, 2).ok, false);
  assert.equal(readCreateRequest({ source: 'fork', fork: 'bx_7ppmwt9v' }, 2).ok, true);
});

test('a fork drops the name it cannot set', () => {
  const result = readCreateRequest({
    source: 'fork',
    fork: 'bx_7ppmwt9v',
    name: 'ignored',
    autoStopHours: 1,
  }, 2);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.input.name, undefined);
  assert.equal(result.ok && result.input.autoStopSeconds, 3_600);
});

test('sizes, names and hours are validated', () => {
  assert.equal(
    readCreateRequest({ source: 'environment', environment: 'web', type: 'huge' as never }, 2).ok,
    false,
  );
  assert.equal(
    readCreateRequest({ source: 'environment', environment: 'web', name: 'x'.repeat(121) }, 2).ok,
    false,
  );
  assert.equal(readCreateRequest({ source: 'environment', environment: 'web', autoStopHours: 0 }, 2).ok, false);
  assert.equal(readCreateRequest({ source: 'environment', environment: 'web', autoStopHours: 3 }, 2).ok, false);
  assert.equal(readCreateRequest({ source: 'environment', environment: 'web', autoStopHours: 1.5 }, 2).ok, false);
  assert.equal(readCreateRequest({ source: 'environment', environment: 'web', autoStopHours: 2 }, 2).ok, true);
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
