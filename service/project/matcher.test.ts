import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Sandbox } from '../../shared/types.ts';
import { folderNameOf, matchSandbox, PROJECT_LABEL_KEY } from './matcher.ts';
import { normalizeRepoSlug } from './slug.ts';

const sandbox = (overrides: Partial<Sandbox> = {}): Sandbox => ({
  id: 'bx_12345678',
  name: 'Box',
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

test('normalizeRepoSlug understands every remote form boat meets', () => {
  assert.equal(normalizeRepoSlug('git@github.com:CODE-73/devine-premier-uae.git'), 'code-73/devine-premier-uae');
  assert.equal(normalizeRepoSlug('https://github.com/OpenChamber/OpenChamber.git'), 'openchamber/openchamber');
  assert.equal(normalizeRepoSlug('ssh://git@github.com/foo/bar'), 'foo/bar');
  assert.equal(normalizeRepoSlug('https://user:secret@github.com/foo/bar.git/'), 'foo/bar');
  assert.equal(normalizeRepoSlug('git://github.com/foo/bar'), 'foo/bar');
  assert.equal(normalizeRepoSlug('  foo/bar  '), 'foo/bar');
  assert.equal(normalizeRepoSlug('https://github.com/foo'), null);
  assert.equal(normalizeRepoSlug('not a repo'), null);
  assert.equal(normalizeRepoSlug(''), null);
});

test('folderNameOf takes the last path segment, lower-case', () => {
  assert.equal(folderNameOf('/Users/me/projects/Divine-Premiere-UAE'), 'divine-premiere-uae');
  assert.equal(folderNameOf('/Users/me/projects/x/'), 'x');
  assert.equal(folderNameOf(null), null);
});

test('priority: label, then repo, then environment name', () => {
  const scope = { folderName: 'divine-premiere-uae', repoSlugs: ['code-73/devine-premier-uae'] };
  const environment = { name: 'base', repos: ['code-73/devine-premier-uae'] };

  const labelled = sandbox({
    environment: 'divine-premiere-uae',
    labels: { [PROJECT_LABEL_KEY]: 'CODE-73/Devine-Premier-UAE' },
  });
  assert.equal(matchSandbox(labelled, environment, scope), 'label');

  const byRepo = sandbox({ environment: 'devine-premier-uae' });
  assert.equal(matchSandbox(byRepo, environment, scope), 'repo');

  const byName = sandbox({ environment: 'Divine-Premiere-UAE' });
  assert.equal(matchSandbox(byName, null, scope), 'name');

  const other = sandbox({ environment: 'base' });
  assert.equal(matchSandbox(other, { name: 'base', repos: ['other/repo'] }, scope), null);
});

test('a label can name the folder instead of a repository', () => {
  const scope = { folderName: 'my project', repoSlugs: [] };
  const labelled = sandbox({ labels: { [PROJECT_LABEL_KEY]: 'My Project' } });
  assert.equal(matchSandbox(labelled, null, scope), 'label');
});

test('repo matching needs the environment list and a project remote', () => {
  const environment = { name: 'base', repos: ['owner/repo'] };
  assert.equal(matchSandbox(sandbox(), environment, { folderName: null, repoSlugs: [] }), null);
  assert.equal(
    matchSandbox(sandbox(), environment, { folderName: null, repoSlugs: ['owner/repo'] }),
    'repo',
  );
  assert.equal(matchSandbox(sandbox(), null, { folderName: null, repoSlugs: ['owner/repo'] }), null);
});
