/** The sandbox list behind a few seconds of cache, with the last good rows kept on failure. */
import type { Sandbox } from '../../shared/types.ts';
import { describeFailure, type Failure } from '../failures.ts';

export type SandboxSnapshot = {
  at: number;
  sandboxes: Sandbox[];
  failure: Failure | null;
};

export type SandboxList = {
  /** The list, fresh or from cache. Never throws; a failure rides on `failure`. */
  get: (force?: boolean) => Promise<SandboxSnapshot>;
  /** The last snapshot, without waiting on the CLI. */
  peek: () => SandboxSnapshot | null;
  /** Drops the cache, so the next read reloads. */
  invalidate: () => void;
};

export const createSandboxList = (options: {
  ttlMs: number;
  load: () => Promise<Sandbox[]>;
  onSnapshot?: (snapshot: SandboxSnapshot) => void;
}): SandboxList => {
  let current: SandboxSnapshot | null = null;
  let loading: Promise<SandboxSnapshot> | null = null;

  const load = async (): Promise<SandboxSnapshot> => {
    let sandboxes: Sandbox[] = [];
    let failure: Failure | null = null;
    try {
      sandboxes = await options.load();
    } catch (error) {
      failure = describeFailure(error);
      sandboxes = current?.sandboxes ?? [];
    }
    const next: SandboxSnapshot = { at: Date.now(), sandboxes, failure };
    current = next;
    options.onSnapshot?.(next);
    return next;
  };

  return {
    get: async (force = false) => {
      if (!force && current && Date.now() - current.at < options.ttlMs) return current;
      if (loading) return loading;
      loading = load().finally(() => {
        loading = null;
      });
      return loading;
    },
    peek: () => current,
    invalidate: () => {
      current = null;
    },
  };
};
