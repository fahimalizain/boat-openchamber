/**
 * Environment names and the repositories they attach. `boat env list` also
 * returns secret files, variables and setup scripts: this module reads names
 * and repository full names only, and drops everything else at the boundary.
 */
import { isRecord, readString } from '../../shared/json.ts';
import { runBoat } from '../boat.ts';
import { normalizeRepoSlug } from '../project/slug.ts';

export type EnvironmentSummary = {
  name: string;
  /** `owner/repo`, lower-case. */
  repos: string[];
};

const repoOf = (entry: unknown): string | null => {
  if (typeof entry === 'string') return normalizeRepoSlug(entry);
  if (!isRecord(entry)) return null;
  return normalizeRepoSlug(readString(entry.fullName) ?? readString(entry.name) ?? '');
};

export const listEnvironments = async (): Promise<EnvironmentSummary[]> => {
  const data = await runBoat('env', ['list'], { timeoutMs: 20_000 });
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.environments)
      ? data.environments
      : [];

  const summaries: EnvironmentSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const name = readString(row.name);
    if (!name) continue;
    const repos = Array.isArray(row.selectedRepositories)
      ? row.selectedRepositories.flatMap((entry) => {
        const slug = repoOf(entry);
        return slug ? [slug] : [];
      })
      : [];
    summaries.push({ name, repos });
  }
  return summaries;
};
