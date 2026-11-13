/**
 * Which sandboxes an OpenChamber project may see.
 *
 * Phase 2.5 replaces the body of `scopeToProject`: match the project's git
 * remote against each boat environment's `selectedRepositories`, case-
 * insensitively; fall back to the environment name against the folder name;
 * honour an optional sandbox label override.
 *
 * Only repository names and environment names take part. Never read, log or
 * emit the secret files or environment variables `boat env` holds.
 */
import type { Sandbox } from '../../shared/types.ts';

export type ProjectScope = {
  /** The OpenChamber project folder, null when no project is open. */
  directory: string | null;
};

export type ProjectScopeFilter = (sandboxes: Sandbox[], scope: ProjectScope) => Sandbox[];

/** Every sandbox belongs to every project until the matcher is filled in. */
export const scopeToProject: ProjectScopeFilter = (sandboxes) => sandboxes;
