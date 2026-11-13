/**
 * Desktop stream URLs, cached for minutes because each call mints a token.
 * `warm` refreshes in the background so a status poll never waits on it.
 */
import { readDesktopUrl } from '../domain/sandboxes.ts';

export type DesktopLinks = {
  get: (sandboxId: string) => Promise<string | null>;
  all: () => Map<string, string | null>;
  warm: (sandboxIds: string[]) => void;
  forget: (sandboxId: string) => void;
  sweep: (valid: Set<string>) => void;
};

type Entry = { at: number; url: string | null };

export const createDesktopLinks = (options: { ttlMs: number }): DesktopLinks => {
  const entries = new Map<string, Entry>();

  const store = (sandboxId: string): void => {
    const previous = entries.get(sandboxId);
    entries.set(sandboxId, { at: Date.now(), url: previous?.url ?? null });
    void readDesktopUrl(sandboxId).then((url) => {
      entries.set(sandboxId, { at: Date.now(), url });
    }, () => {
      entries.set(sandboxId, { at: Date.now(), url: null });
    });
  };

  return {
    get: async (sandboxId) => {
      const cached = entries.get(sandboxId);
      if (cached?.url && Date.now() - cached.at < options.ttlMs) return cached.url;
      const url = await readDesktopUrl(sandboxId);
      entries.set(sandboxId, { at: Date.now(), url });
      return url;
    },
    all: () => new Map([...entries].map(([id, entry]) => [id, entry.url])),
    warm: (sandboxIds) => {
      const now = Date.now();
      for (const sandboxId of sandboxIds) {
        const cached = entries.get(sandboxId);
        if (cached && now - cached.at < options.ttlMs) continue;
        store(sandboxId);
      }
    },
    forget: (sandboxId) => {
      entries.delete(sandboxId);
    },
    sweep: (valid) => {
      for (const id of [...entries.keys()]) if (!valid.has(id)) entries.delete(id);
    },
  };
};
