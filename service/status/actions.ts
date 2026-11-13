/** Reads a row action id from the status section and runs it. */
import { parseStatusActionId, statusActionId } from '../../shared/routes.ts';
import type { Sandbox, SandboxActionVerb } from '../../shared/types.ts';
import { extendSandbox, extendSeconds, resumeSandbox, stopSandbox } from '../domain/sandboxes.ts';

export type StatusAction = { verb: SandboxActionVerb; sandboxId: string };

export const readStatusAction = (body: string, sandboxes: Sandbox[]): StatusAction | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body || '{}');
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const id = (parsed as { id?: unknown }).id;
  if (typeof id !== 'string') return null;

  const decoded = parseStatusActionId(id);
  if (!decoded) return null;
  // Match the live list so an id with more than one underscore still resolves.
  const known = sandboxes.find((sandbox) => statusActionId(decoded.verb, sandbox.id) === id);
  return known ? { verb: decoded.verb, sandboxId: known.id } : decoded;
};

export const performSandboxAction = async (verb: SandboxActionVerb, sandbox: Sandbox): Promise<void> => {
  if (verb === 'stop') {
    await stopSandbox(sandbox.id);
    return;
  }
  if (verb === 'resume') {
    await resumeSandbox(sandbox.id);
    return;
  }
  await extendSandbox(sandbox.id, extendSeconds(sandbox));
};
