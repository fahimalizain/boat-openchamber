/** The project's git remotes as `owner/repo`, origin first, cached per folder. */
import { execFile } from 'node:child_process';

import { normalizeRepoSlug } from './slug.ts';

const GIT_TIMEOUT_MS = 2_000;
const MAX_REMOTES = 8;

const git = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile('git', args, { timeout: GIT_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

export const readProjectRemotes = async (directory: string): Promise<string[]> => {
  let names: string[];
  try {
    names = (await git(['-C', directory, 'remote']))
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, MAX_REMOTES);
  } catch {
    return [];
  }
  if (names.length === 0) return [];

  const ordered = names.includes('origin') ? ['origin', ...names.filter((name) => name !== 'origin')] : names;
  const slugs: string[] = [];
  for (const name of ordered) {
    try {
      const slug = normalizeRepoSlug((await git(['-C', directory, 'remote', 'get-url', name])).trim());
      if (slug && !slugs.includes(slug)) slugs.push(slug);
    } catch {
      // A remote with no URL is one git mentions but cannot resolve.
    }
  }
  return slugs;
};

export type RemoteCache = {
  get: (directory: string) => Promise<string[]>;
};

export const createRemoteCache = (options: { ttlMs: number }): RemoteCache => {
  const entries = new Map<string, { at: number; slugs: string[] }>();

  return {
    get: async (directory) => {
      const cached = entries.get(directory);
      if (cached && Date.now() - cached.at < options.ttlMs) return cached.slugs;
      const slugs = await readProjectRemotes(directory);
      entries.set(directory, { at: Date.now(), slugs });
      return slugs;
    },
  };
};
