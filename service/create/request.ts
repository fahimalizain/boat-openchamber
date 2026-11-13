/** Validates a create request and turns it into the CLI's input. */
import { readString } from '../../shared/json.ts';
import type { CreateSandboxRequest } from '../../shared/routes.ts';
import { isSandboxSize, type SandboxSize } from '../../shared/types.ts';
import type { CreateInput } from '../domain/sandboxes.ts';
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

export const readCreateRequest = (
  body: CreateSandboxRequest | null,
  autoStopMaxHours: number,
): CreateRequestResult => {
  if (!body) return { ok: false, error: 'Unknown create request.' };
  const { source } = body;
  if (source !== 'environment' && source !== 'snapshot' && source !== 'fork') {
    return { ok: false, error: 'Pick where the sandbox comes from.' };
  }

  const environment = readString(body.environment);
  const snapshot = readString(body.snapshot);
  const fork = readString(body.fork);
  const type = readString(body.type);
  const name = readString(body.name);
  const hours = typeof body.autoStopHours === 'number' && Number.isFinite(body.autoStopHours)
    ? body.autoStopHours
    : 1;

  if (source === 'environment' && !environment) return { ok: false, error: 'Pick an environment.' };
  if (source === 'snapshot' && !snapshot) return { ok: false, error: 'Pick a saved snapshot.' };
  if (source === 'fork' && !isSandboxId(fork)) return { ok: false, error: 'Pick a sandbox to fork.' };
  if (type && !isSandboxSize(type)) return { ok: false, error: 'Unknown machine size.' };
  if (name && name.length > MAX_NAME_CHARS) {
    return { ok: false, error: `That name is too long (${MAX_NAME_CHARS} characters).` };
  }
  if (!Number.isInteger(hours) || hours < 1 || hours > autoStopMaxHours) {
    return { ok: false, error: `Auto-stop must be between 1 and ${autoStopMaxHours} hours.` };
  }

  return {
    ok: true,
    input: {
      source,
      environment: source === 'environment' ? environment ?? undefined : undefined,
      snapshot: source === 'snapshot' ? snapshot ?? undefined : undefined,
      fork: source === 'fork' ? fork ?? undefined : undefined,
      type: (type as SandboxSize | null) ?? undefined,
      // A fork keeps its generated name; `boat fork` has no `--name`.
      name: source === 'fork' ? undefined : name ?? undefined,
      autoStopSeconds: hours * 3_600,
    },
  };
};
