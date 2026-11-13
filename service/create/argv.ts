/** Builds the `boat new` / `boat fork` argv from a create request. */
import type { CreateStart } from '../../shared/routes.ts';
import type { SandboxSize } from '../../shared/types.ts';

export type CreateInput = {
  start: CreateStart;
  /** Undefined: the account default, or the source's environment for a copy. */
  environment?: string;
  /** Undefined: the default size, or the source's size for a copy. */
  size?: SandboxSize;
  /** `--name` for a new sandbox; a rename after the fork for a copy. */
  name?: string;
  autoStopSeconds?: number;
};

export type CreateCommand = {
  command: 'new' | 'fork';
  args: string[];
};

export const createCommand = (input: CreateInput): CreateCommand => {
  const args: string[] = [];
  if (input.size) args.push('--type', input.size);
  if (input.autoStopSeconds) args.push('--ttl', String(input.autoStopSeconds));

  if (input.start.kind === 'copy') {
    if (input.environment) args.push('--environment', input.environment);
    // No --name on a fork: the name is applied with `boat rename` after it starts.
    return { command: 'fork', args: [...args, '--wait', input.start.sandboxId] };
  }

  if (input.name) args.push('--name', input.name);
  if (input.environment) args.push('--environment', input.environment);
  if (input.start.kind === 'snapshot') args.push('--from', input.start.name);

  return { command: 'new', args };
};
