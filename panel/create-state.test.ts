import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CreateOptionsResponse } from '../shared/routes.ts';
import {
  blockedReason,
  createRequest,
  defaultForm,
  hoursMax,
  sizeOptions,
  type CreateForm,
} from './create-state.ts';

const options = (overrides: Partial<CreateOptionsResponse> = {}): CreateOptionsResponse => ({
  environments: [
    { name: 'base', isDefault: true },
    { name: 'web', isDefault: false },
  ],
  snapshots: [{ name: 'worker-base-20261113', type: 'default', createdAt: null }],
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

const form = (overrides: Partial<CreateForm> = {}): CreateForm => ({
  source: 'environment',
  environment: 'web',
  snapshot: 'worker-base-20261113',
  fork: null,
  type: 'default',
  name: '',
  autoStopHours: 1,
  ...overrides,
});

test('defaults follow the project, then the account default', () => {
  const dated = defaultForm(options(), '/Users/me/projects/MyApp', Date.UTC(2026, 10, 13));
  assert.equal(dated.environment, 'web');
  assert.equal(dated.type, 'default');
  assert.equal(dated.autoStopHours, 1);
  assert.equal(dated.name, 'MyApp 2026-11-13');
  assert.equal(dated.snapshot, 'worker-base-20261113');

  const withoutSuggestion = defaultForm(options({ suggestedEnvironment: null }), null);
  assert.equal(withoutSuggestion.environment, 'base');
  assert.equal(withoutSuggestion.name, '');
});

test('the auto-stop cap comes from the plan with a sane fallback', () => {
  assert.equal(hoursMax(options()), 2);
  assert.equal(hoursMax(null), 1);
});

test('Create is blocked with a reason', () => {
  assert.equal(blockedReason(form(), options()), null);

  assert.match(blockedReason(form(), null) ?? '', /still loading/);
  assert.equal(
    blockedReason(form(), options({ limits: { ...options().limits, canStart: false, reason: 'No card.' } })),
    'No card.',
  );
  assert.match(
    blockedReason(form(), options({ limits: { ...options().limits, active: 2, maxActive: 2 } })) ?? '',
    /slots are in use/,
  );
  assert.match(blockedReason(form({ environment: null }), options()) ?? '', /Pick an environment/);
  assert.match(blockedReason(form({ source: 'snapshot', snapshot: null }), options()) ?? '', /saved snapshot/);
  assert.match(blockedReason(form({ source: 'fork', fork: null }), options()) ?? '', /sandbox to fork/);
  assert.match(blockedReason(form({ type: 'xlarge' }), options()) ?? '', /100\/month/);
  assert.match(blockedReason(form({ autoStopHours: 3 }), options()) ?? '', /capped at 2 hours/);
  assert.match(blockedReason(form({ autoStopHours: 0 }), options()) ?? '', /at least 1 hour/);
  assert.match(blockedReason(form({ name: 'x'.repeat(121) }), options()) ?? '', /too long/);
});

test('the request keeps only what the chosen source needs', () => {
  assert.deepEqual(createRequest(form({ name: ' web ' })), {
    source: 'environment',
    environment: 'web',
    type: 'default',
    name: 'web',
    autoStopHours: 1,
  });

  assert.deepEqual(createRequest(form({ source: 'fork', fork: 'bx_7ppmwt9v', name: 'ignored' })), {
    source: 'fork',
    fork: 'bx_7ppmwt9v',
    type: 'default',
    autoStopHours: 1,
  });
});

test('size options carry the plan reason on blocked sizes', () => {
  const sizes = sizeOptions(options());
  assert.equal(sizes.length, 4);
  assert.equal(sizes.find((size) => size.id === 'default')?.hint, undefined);
  assert.match(sizes.find((size) => size.id === 'xlarge')?.hint ?? '', /100\/month/);
});
