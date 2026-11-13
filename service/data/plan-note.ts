/** The one plan warning the status section shows, refreshed on a slow clock. */
import { readLimits } from '../domain/limits.ts';

export type PlanNote = {
  current: () => string | null;
  refresh: () => void;
};

export const createPlanNote = (options: { ttlMs: number }): PlanNote => {
  let note: string | null = null;
  let refreshedAt = 0;

  return {
    current: () => note,
    refresh: () => {
      const now = Date.now();
      if (now - refreshedAt < options.ttlMs) return;
      refreshedAt = now;
      void readLimits().then((limits) => {
        if (!limits.canStart && limits.blockedReason) {
          note = limits.blockedReason;
          return;
        }
        if (limits.active !== null && limits.maxActive !== null && limits.active >= limits.maxActive) {
          note = `All ${limits.maxActive} sandbox slots are in use. Stop one to start another.`;
          return;
        }
        note = null;
      }, () => {
        note = null;
      });
    },
  };
};
