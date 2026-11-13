/** Environment summaries behind a minute of cache; a failed read keeps the last good list. */
import type { EnvironmentSummary } from '../domain/environments.ts';

export type EnvironmentList = {
  get: (options?: { force?: boolean }) => Promise<EnvironmentSummary[]>;
};

export const createEnvironmentList = (options: {
  ttlMs: number;
  load: () => Promise<EnvironmentSummary[]>;
}): EnvironmentList => {
  let entries: EnvironmentSummary[] = [];
  let loadedAt = 0;
  let loading: Promise<EnvironmentSummary[]> | null = null;

  const read = async (): Promise<EnvironmentSummary[]> => {
    try {
      entries = await options.load();
    } catch {
      // Keep the last good list: scoping is best-effort, never a reason to hide sandboxes.
    }
    loadedAt = Date.now();
    return entries;
  };

  return {
    get: async (settings = {}) => {
      if (!settings.force && loadedAt > 0 && Date.now() - loadedAt < options.ttlMs) return entries;
      if (loading) return loading;
      loading = read().finally(() => {
        loading = null;
      });
      return loading;
    },
  };
};
