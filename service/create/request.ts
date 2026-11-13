/** Validates a create request and turns it into the CLI's input. */
import { readString } from '../../shared/json.ts';
import type { CreateSandboxRequest, CreateStart } from '../../shared/routes.ts';
import { isSandboxSize, type SandboxSize } from '../../shared/types.ts';
import type { CreateInput } from './argv.ts';
import type { PlanLimits } from '../domain/limits.ts';
import { isSandboxId } from '../validation.ts';

export const MAX_NAME_CHARS = 120;

export type CreateRequestResult =
  | { ok: true; input: CreateInput }
  | { ok: false; error: string };

export const limitsBlockedReason = (limits: PlanLimits): string | null => {
  if (!limits.canStart) return limits.blockedReason ?? 'The plan cannot start a sandbox right now.';
  if (limits.active !== null && limits.maxActive !== null && limits.active >= limits.maxActive) {
    return `All ${limits.maxActive} sandbox slots are in use. Stop one first.`;
  }
  return null;
};

const readStart = (body: CreateSandboxRequest): CreateStart | { error: string } => {
  const start = body.start;
  if (start?.kind === 'clean') return { kind: 'clean' };

  if (start?.kind === 'snapshot') {
    const name = readString(start.name);
    return name ? { kind: 'snapshot', name } : { error: 'Pick a saved snapshot.' };
  }

  if (start?.kind === 'copy') {
    const sandboxId = readString(start.sandboxId);
    return isSandboxId(sandboxId)
      ? { kind: 'copy', sandboxId }
      : { error: 'Pick a sandbox to copy.' };
  }

  return { error: 'Pick what the sandbox starts from.' };
};

export const readCreateRequest = (
  body: CreateSandboxRequest | null,
  autoStopMaxHours: number,
): CreateRequestResult => {
  if (!body) return { ok: false, error: 'Unknown create request.' };

  const start = readStart(body);
  if ('error' in start) return { ok: false, error: start.error };

  const environment = readString(body.environment);
  const size = readString(body.size);
  const name = readString(body.name);
  const hours = typeof body.autoStopHours === 'number' && Number.isFinite(body.autoStopHours)
    ? body.autoStopHours
    : 1;

  if (size && !isSandboxSize(size)) return { ok: false, error: 'Unknown machine size.' };
  if (name && name.length > MAX_NAME_CHARS) {
    return { ok: false, error: `That name is too long (${MAX_NAME_CHARS} characters).` };
  }
  if (!Number.isInteger(hours) || hours < 1 || hours > autoStopMaxHours) {
    return { ok: false, error: `Auto-stop must be between 1 and ${autoStopMaxHours} hours.` };
  }

  return {
    ok: true,
    input: {
      start,
      environment: environment ?? undefined,
      size: (size as SandboxSize | null) ?? undefined,
      name: name ?? undefined,
      autoStopSeconds: hours * 3_600,
    },
  };
};
