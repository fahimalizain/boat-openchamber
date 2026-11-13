/** The pure half of project scoping: which sandbox belongs to which project. */
import type { ProjectMatch, Sandbox } from '../../shared/types.ts';
import type { EnvironmentSummary } from '../domain/environments.ts';
import { normalizeRepoSlug } from './slug.ts';

/** The label that pins a sandbox to a project. Boat label keys allow dots. */
export const PROJECT_LABEL_KEY = 'openchamber.project';

export type ProjectScope = {
  /** The project folder's name, lower-case. */
  folderName: string | null;
  /** Every `owner/repo` the project's git remotes point at. */
  repoSlugs: string[];
};

export const folderNameOf = (directory: string | null): string | null => {
  if (!directory) return null;
  const parts = directory.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1]?.toLowerCase() ?? null;
};

const labelMatches = (sandbox: Sandbox, scope: ProjectScope): boolean => {
  const label = sandbox.labels[PROJECT_LABEL_KEY]?.trim();
  if (!label) return false;
  const slug = normalizeRepoSlug(label);
  if (slug && scope.repoSlugs.includes(slug)) return true;
  if (!scope.folderName) return false;
  if (slug === scope.folderName) return true;
  return label.toLowerCase() === scope.folderName;
};

/**
 * Priority: the label override, then a repository the environment attaches,
 * then the environment name against the folder name.
 */
export const matchSandbox = (
  sandbox: Sandbox,
  environment: EnvironmentSummary | null,
  scope: ProjectScope,
): ProjectMatch | null => {
  if (labelMatches(sandbox, scope)) return 'label';

  if (environment && scope.repoSlugs.length > 0) {
    if (environment.repos.some((repo) => scope.repoSlugs.includes(repo))) return 'repo';
  }

  const env = sandbox.environment?.toLowerCase() ?? null;
  if (scope.folderName && env === scope.folderName) return 'name';

  return null;
};
