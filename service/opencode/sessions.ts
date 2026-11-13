/**
 * A short-lived cache of each sandbox's OpenCode sessions, and the busy set
 * derived from it. The status badge, the marks and `@` mentions read this;
 * `check` only refreshes sandboxes whose OpenCode connection is already known,
 * so drawing a badge never starts a server in a sandbox the user is not using.
 */
import type { OpencodeSession } from '../../shared/opencode.ts';
import type { OpencodeConnections } from './connection.ts';
import { readSessions } from './reads.ts';

export type OpencodeSessions = {
  /** Reads the sessions, starting the sandbox's connection when it has none. */
  get: (sandboxId: string, options?: { force?: boolean }) => Promise<OpencodeSession[]>;
  /** The cached sessions, or null before the first read. */
  peek: (sandboxId: string) => OpencodeSession[] | null;
  /** True while the last read found a busy session. */
  busy: (sandboxId: string) => boolean;
  busyAll: () => ReadonlySet<string>;
  /** Refreshes on a slow clock, but only over an established connection. */
  check: (sandboxId: string) => void;
  forget: (sandboxId: string) => void;
  sweep: (valid: Set<string>) => void;
};

export const createOpencodeSessions = (options: {
  connections: OpencodeConnections;
  /** How long a session list is reused by the panel's reads. */
  ttlMs: number;
  /** How often the badge checks a sandbox again. */
  checkMs: number;
}): OpencodeSessions => {
  const entries = new Map<string, { at: number; sessions: OpencodeSession[] }>();
  const busy = new Set<string>();
  const checkedAt = new Map<string, number>();
  const pending = new Map<string, Promise<OpencodeSession[]>>();

  const remember = (sandboxId: string, sessions: OpencodeSession[]): OpencodeSession[] => {
    entries.set(sandboxId, { at: Date.now(), sessions });
    if (sessions.some((session) => session.status === 'busy')) busy.add(sandboxId);
    else busy.delete(sandboxId);
    return sessions;
  };

  const load = (sandboxId: string): Promise<OpencodeSession[]> => {
    const running = pending.get(sandboxId);
    if (running) return running;
    const promise = options.connections
      .run(sandboxId, (connection) => readSessions(connection))
      .then((sessions) => remember(sandboxId, sessions))
      .finally(() => {
        if (pending.get(sandboxId) === promise) pending.delete(sandboxId);
      });
    pending.set(sandboxId, promise);
    return promise;
  };

  return {
    get: async (sandboxId, readOptions = {}) => {
      const cached = entries.get(sandboxId);
      if (!readOptions.force && cached && Date.now() - cached.at < options.ttlMs) return cached.sessions;
      return load(sandboxId);
    },
    peek: (sandboxId) => entries.get(sandboxId)?.sessions ?? null,
    busy: (sandboxId) => busy.has(sandboxId),
    busyAll: () => busy,
    check: (sandboxId) => {
      const now = Date.now();
      if (now - (checkedAt.get(sandboxId) ?? 0) < options.checkMs) return;
      if (!options.connections.peek(sandboxId)) return;
      checkedAt.set(sandboxId, now);
      void load(sandboxId).catch(() => {
        // An unreadable session list keeps the badge as it was.
      });
    },
    forget: (sandboxId) => {
      entries.delete(sandboxId);
      busy.delete(sandboxId);
      checkedAt.delete(sandboxId);
    },
    sweep: (valid) => {
      for (const id of [...entries.keys()]) if (!valid.has(id)) entries.delete(id);
      for (const id of [...busy]) if (!valid.has(id)) busy.delete(id);
      for (const id of [...checkedAt.keys()]) if (!valid.has(id)) checkedAt.delete(id);
    },
  };
};
