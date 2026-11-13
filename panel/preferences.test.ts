import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { JsonValue } from '@openchamber/sdk';

import { createPreferences, preferenceKey, readPreferences } from './preferences.ts';

test('preference keys are stable, short and distinct per folder', () => {
  const key = preferenceKey('/Users/me/projects/My App');
  assert.equal(key, preferenceKey('/Users/me/projects/My App'));
  assert.match(key, /^boat\.prefs\.[a-z0-9-]+\.[a-z0-9]+$/);
  assert.ok(key.length <= 128);

  assert.notEqual(preferenceKey('/Users/me/App'), preferenceKey('/Users/me/app'));
  assert.equal(preferenceKey(null), 'boat.prefs.global');
});

test('stored values are read defensively', () => {
  assert.deepEqual(
    readPreferences({ sandboxId: 'bx_7ppmwt9v', provider: 'claude', model: 'sonnet', reasoning: 'high', tab: 'conversations' }),
    { sandboxId: 'bx_7ppmwt9v', provider: 'claude', model: 'sonnet', reasoning: 'high', tab: 'conversations' },
  );
  assert.deepEqual(readPreferences({ sandboxId: 42 }), {
    sandboxId: null,
    provider: null,
    model: null,
    reasoning: null,
    tab: null,
  });
  assert.equal(readPreferences({ tab: 'settings' })?.tab, null);
  assert.equal(readPreferences('nope'), null);
});

test('without device storage the preferences live in memory', async () => {
  const store = createPreferences({ storage: null, device: false });
  const wanted = {
    sandboxId: 'bx_7ppmwt9v',
    provider: 'claude',
    model: 'sonnet',
    reasoning: 'high',
    tab: 'conversations' as const,
  };

  assert.equal(await store.get('/repo'), null);
  await store.save('/repo', wanted);
  assert.deepEqual(await store.get('/repo'), wanted);
});

test('a host that refuses device storage falls back to memory', async () => {
  let sets = 0;
  const storage = {
    get: async (): Promise<JsonValue | undefined> => {
      throw new Error('UNSUPPORTED');
    },
    set: async (): Promise<void> => {
      sets += 1;
      throw new Error('UNSUPPORTED');
    },
  };
  const store = createPreferences({ storage, device: true });
  const wanted = { sandboxId: null, provider: 'codex', model: '', reasoning: null, tab: null };

  await store.save('/repo', wanted);
  assert.equal(sets, 1);
  assert.deepEqual(await store.get('/repo'), wanted);
});
