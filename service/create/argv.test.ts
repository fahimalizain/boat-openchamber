import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommand } from './argv.ts';

test('a clean machine with every default passes no flags', () => {
  assert.deepEqual(createCommand({ start: { kind: 'clean' } }), { command: 'new', args: [] });
});

test('a clean machine carries the environment, size, name and TTL', () => {
  assert.deepEqual(
    createCommand({
      start: { kind: 'clean' },
      environment: 'web',
      size: 'large',
      name: 'web 2026-11-13',
      autoStopSeconds: 7_200,
    }),
    {
      command: 'new',
      args: ['--type', 'large', '--ttl', '7200', '--name', 'web 2026-11-13', '--environment', 'web'],
    },
  );
});

test('a snapshot start passes --from and the environment it was given', () => {
  assert.deepEqual(
    createCommand({
      start: { kind: 'snapshot', name: 'worker-base' },
      environment: 'web',
      size: 'default',
      autoStopSeconds: 3_600,
    }),
    {
      command: 'new',
      args: ['--type', 'default', '--ttl', '3600', '--environment', 'web', '--from', 'worker-base'],
    },
  );
});

test('a snapshot without an environment lets boat use the account default', () => {
  assert.deepEqual(
    createCommand({ start: { kind: 'snapshot', name: 'worker-base' } }),
    { command: 'new', args: ['--from', 'worker-base'] },
  );
});

test('a copy with overrides passes none of them', () => {
  assert.deepEqual(
    createCommand({ start: { kind: 'copy', sandboxId: 'bx_7ppmwt9v' } }),
    { command: 'fork', args: ['--wait', 'bx_7ppmwt9v'] },
  );
});

test('a copy with an environment and a size passes both, and never a name', () => {
  assert.deepEqual(
    createCommand({
      start: { kind: 'copy', sandboxId: 'bx_7ppmwt9v' },
      environment: 'web',
      size: 'large',
      name: 'should be a rename',
      autoStopSeconds: 3_600,
    }),
    {
      command: 'fork',
      args: ['--type', 'large', '--ttl', '3600', '--environment', 'web', '--wait', 'bx_7ppmwt9v'],
    },
  );
});
