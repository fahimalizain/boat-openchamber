/**
 * The project matcher seam. A sandbox belongs to the open OpenChamber project
 * when its `openchamber.project` label names the project, else when its
 * environment attaches the project's repository, else when the environment
 * name matches the folder name. With no project everything passes through
 * unscoped, as before.
 *
 * Only repository names, environment names and labels take part. Never read,
 * log or emit the secret files or variables `boat env` holds.
 */
import { isAbsolute } from 'node:path';

import type { ProjectMatch, Sandbox } from '../../shared/types.ts';
import type { EnvironmentList } from '../data/environment-list.ts';
import type { EnvironmentSummary } from '../domain/environments.ts';
import { folderNameOf, matchSandbox, type ProjectScope } from './matcher.ts';
import type { ProjectRanking } from './ranking.ts';
import type { RemoteCache } from './remotes.ts';

export type ScopedSandbox = {
  sandbox: Sandbox;
  matchedBy: ProjectMatch | null;
  inProject: boolean;
};

export type ScopeResult = {
  entries: ScopedSandbox[];
  scoped: boolean;
  folderName: string | null;
  /** Sandboxes that exist but belong to another project. */
  others: number;
};

export type Scoper = {
  apply: (sandboxes: Sandbox[], directory: string | null) => Promise<ScopeResult>;
};

const usableDirectory = (directory: string | null): string | null => (
  directory && isAbsolute(directory) && !directory.includes('\0') ? directory : null
);

export const createScoper = (deps: {
  environments: EnvironmentList;
  remotes: RemoteCache;
  ranking: ProjectRanking;
}): Scoper => ({
  apply: async (sandboxes, directory) => {
    const project = usableDirectory(directory);
    if (!project) {
      return {
        entries: sandboxes.map((sandbox): ScopedSandbox => ({ sandbox, matchedBy: null, inProject: false })),
        scoped: false,
        folderName: null,
        others: 0,
      };
    }

    const folderName = folderNameOf(project);
    const [repoSlugs, environments] = await Promise.all([
      deps.remotes.get(project),
      deps.environments.get().catch(() => [] as EnvironmentSummary[]),
    ]);
    const byName = new Map(environments.map((environment) => [environment.name.toLowerCase(), environment]));
    const scope: ProjectScope = { folderName, repoSlugs };

    const entries = sandboxes.map((sandbox): ScopedSandbox => {
      const environment = sandbox.environment ? byName.get(sandbox.environment.toLowerCase()) ?? null : null;
      const matchedBy = matchSandbox(sandbox, environment, scope);
      return { sandbox, matchedBy, inProject: matchedBy !== null };
    });

    deps.ranking.remember(
      project,
      new Set(entries.filter((entry) => entry.inProject).map((entry) => entry.sandbox.id)),
    );

    return {
      entries,
      scoped: true,
      folderName,
      others: entries.filter((entry) => !entry.inProject).length,
    };
  },
});
