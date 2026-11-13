/**
 * Puts a mark on each registered project's sidebar rows. Runs on the existing
 * sandbox refresh, sets only what changed, and backs off when the host says 429.
 */
import type { ServiceMark } from '@openchamber/sdk';

import type { ProjectRegistry } from '../data/project-registry.ts';
import type { RunningAgents } from '../data/running-agents.ts';
import type { SandboxSnapshot } from '../data/sandbox-list.ts';
import type { Scoper } from '../project/scope.ts';
import { buildProjectMark, changedMarks, type ProjectMark } from './mark.ts';

const RATE_WINDOW_MS = 60_000;
/** Headroom under the host's 60 marks a minute. */
const RATE_MAX = 50;
const BACKOFF_MS = 60_000;

export type Marker = {
  sync: (snapshot: SandboxSnapshot) => void;
};

const isRateLimited = (failure: unknown): boolean => {
  if (typeof failure === 'object' && failure !== null && 'status' in failure) {
    if ((failure as { status?: unknown }).status === 429) return true;
  }
  const message = failure instanceof Error ? failure.message : '';
  return /429|rate limit|too many requests/i.test(message);
};

export const createMarker = (deps: {
  projects: ProjectRegistry;
  scoper: Scoper;
  agents: RunningAgents;
  setMark: (target: { directory: string }, mark: ServiceMark | null) => Promise<unknown>;
  now?: () => number;
}): Marker => {
  const previous = new Map<string, ProjectMark | null>();
  const calls: number[] = [];
  const now = deps.now ?? Date.now;
  let syncing = false;
  let cooldownUntil = 0;

  const withinRate = (at: number): boolean => {
    while (calls.length > 0 && at - (calls[0] ?? 0) > RATE_WINDOW_MS) calls.shift();
    return calls.length < RATE_MAX;
  };

  const run = async (snapshot: SandboxSnapshot): Promise<void> => {
    if (now() < cooldownUntil) return;

    const next = new Map<string, ProjectMark | null>();
    for (const directory of deps.projects.list()) {
      try {
        const scope = await deps.scoper.apply(snapshot.sandboxes, directory);
        const sandboxes = scope.entries.filter((entry) => entry.inProject).map((entry) => entry.sandbox);
        next.set(directory, buildProjectMark(sandboxes, deps.agents.all()));
      } catch {
        // Leave this project's mark as it was; the next refresh retries.
        const current = previous.get(directory);
        if (current !== undefined) next.set(directory, current);
      }
    }

    for (const change of changedMarks(previous, next)) {
      if (!withinRate(now())) return;
      try {
        await deps.setMark({ directory: change.directory }, change.mark);
        calls.push(now());
        if (change.mark) previous.set(change.directory, change.mark);
        else previous.delete(change.directory);
      } catch (failure) {
        if (isRateLimited(failure)) {
          cooldownUntil = now() + BACKOFF_MS;
          return;
        }
        // Another refusal is retried on the next refresh.
      }
    }
  };

  return {
    sync: (snapshot) => {
      if (syncing) return;
      syncing = true;
      void run(snapshot).finally(() => {
        syncing = false;
      });
    },
  };
};
