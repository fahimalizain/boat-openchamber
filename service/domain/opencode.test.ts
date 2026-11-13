import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  chooseSessionDirectory,
  readHostedUrl,
  readOpencodeService,
  readPairLink,
  readServicePort,
} from './opencode.ts';

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

const scriptOutput = (sections: {
  status?: string;
  password?: string;
  home?: string;
  repos?: string[];
}): string => [
  '__BOAT_OPENCODE_STATUS__',
  sections.status ?? 'http://127.0.0.1:49374',
  '__BOAT_OPENCODE_PASSWORD__',
  sections.password ?? 'NYfs9p0iDykUlcsnnB1GTgF8WtqXjwviQXNzcBt-_ic',
  '__BOAT_OPENCODE_HOME__',
  sections.home ?? '/home/user',
  '__BOAT_OPENCODE_REPOS__',
  ...(sections.repos ?? []),
].join('\n');

test('the ensure script output yields the address, password and directories', () => {
  assert.deepEqual(
    readOpencodeService(scriptOutput({ repos: ['/home/user/app', '/home/user/lib'] })),
    {
      port: 49374,
      password: 'NYfs9p0iDykUlcsnnB1GTgF8WtqXjwviQXNzcBt-_ic',
      home: '/home/user',
      repos: ['/home/user/app', '/home/user/lib'],
      directory: '/home/user/app',
      directories: ['/home/user/app', '/home/user/lib', '/home/user'],
    },
  );
});

test('with no repositories the home directory is the default session location', () => {
  const service = readOpencodeService(scriptOutput({}));
  assert.equal(service?.directory, '/home/user');
  assert.deepEqual(service?.directories, ['/home/user']);
  assert.equal(chooseSessionDirectory('/home/user', []), '/home/user');
  assert.equal(chooseSessionDirectory('/home/user', ['/home/user/b', '/home/user/a']), '/home/user/a');
});

test('missing OpenCode, a bad password or a dead port is not a service', () => {
  assert.equal(readOpencodeService('__BOAT_OPENCODE_MISSING__'), null);
  assert.equal(readOpencodeService(scriptOutput({ password: '' })), null);
  assert.equal(readOpencodeService(scriptOutput({ password: 'not a password' })), null);
  assert.equal(readOpencodeService(scriptOutput({ status: 'stopped' })), null);
  assert.equal(readOpencodeService(scriptOutput({ home: '' })), null);
});

test('repositories outside the home list are ignored', () => {
  const service = readOpencodeService(scriptOutput({ repos: ['/srv/app', 'relative/dir', '/home/user/app'] }));
  assert.deepEqual(service?.repos, ['/srv/app', '/home/user/app']);
  assert.equal(service?.directory, '/home/user/app');
});

test('the home directory is not repeated in the repository list', () => {
  const service = readOpencodeService(scriptOutput({ repos: ['/home/user'] }));
  assert.deepEqual(service?.repos, []);
  assert.deepEqual(service?.directories, ['/home/user']);
});
