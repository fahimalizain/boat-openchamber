import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readHostedUrl, readPairLink, readServicePort } from './opencode.ts';

test('the service port comes from the status line', () => {
  assert.equal(readServicePort('http://127.0.0.1:49374\n'), 49374);
  assert.equal(readServicePort('stopped\n'), null);
});

test('a hosted URL splits into origin and token', () => {
  assert.deepEqual(
    readHostedUrl({ url: 'https://box-node-1-49374.on.boat.dev?_token=abc' }),
    { origin: 'https://box-node-1-49374.on.boat.dev', token: 'abc' },
  );
  assert.deepEqual(
    readHostedUrl({ url: 'https://box-node-1-49374.on.boat.dev' }),
    { origin: 'https://box-node-1-49374.on.boat.dev', token: null },
  );
  assert.equal(readHostedUrl({ url: 'http://example.com' }), null);
  assert.equal(readHostedUrl(null), null);
});

test('the pair link must point at the hosted origin', () => {
  const origin = 'https://box-node-1-49374.on.boat.dev';
  const output = [
    '  Open a link to connect. Links work once and expire in 5 minutes.',
    '',
    '  http://127.0.0.1:49374/auth/connect/local_1',
    `  ${origin}/auth/connect/9tFPZxHX-qyS_b`,
  ].join('\n');
  assert.equal(readPairLink(output, origin), `${origin}/auth/connect/9tFPZxHX-qyS_b`);
  assert.equal(readPairLink('no link here', origin), null);
});
