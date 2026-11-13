/** Sandbox reads and lifecycle commands, mapped into the shared shape. */
import type { ChildProcess } from 'node:child_process';

import { isRecord, readNumber, readString } from '../../shared/json.ts';
import type { Sandbox } from '../../shared/types.ts';
import { BoatError, runBoat, spawnBoat } from '../boat.ts';
import { createCommand, type CreateInput } from '../create/argv.ts';
const MUTATION_TIMEOUT_MS = 25_000;

const readLabels = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const labels: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const text = readString(entry);
    if (text) labels[key] = text;
  }
  return labels;
};

const toSandbox = (row: Record<string, unknown>): Sandbox | null => {
  const id = readString(row.id);
  if (!id) return null;
  return {
    id,
    name: readString(row.name) ?? id,
    state: readString(row.state) ?? 'unknown',
    type: readString(row.type),
    vcpu: readNumber(row.vcpu),
    memoryGB: readNumber(row.memoryGB),
    createdAt: readString(row.createdAt),
    archiveAfter: readString(row.archiveAfter),
    stoppedAt: readString(row.stoppedAt),
    url: readString(row.url),
    ttlSeconds: readNumber(row.ttlSeconds),
    desktopAvailable: row.desktopAvailable === true,
    environment: readString(row.environment),
    health: readString(row.health),
    sshEndpoint: readString(row.sshEndpoint),
    labels: readLabels(row.labels),
  };
};

export const listSandboxes = async (): Promise<Sandbox[]> => {
  const data = await runBoat('list', ['--all']);
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.sandboxes)
      ? data.sandboxes
      : [];
  return rows.filter(isRecord).flatMap((row) => {
    const sandbox = toSandbox(row);
    return sandbox ? [sandbox] : [];
  });
};

export const stopSandbox = async (sandboxId: string): Promise<void> => {
  await runBoat('stop', [sandboxId, '--yes'], { timeoutMs: MUTATION_TIMEOUT_MS });
};

export const resumeSandbox = async (sandboxId: string): Promise<void> => {
  await runBoat('resume', [sandboxId, '--no-wait'], { timeoutMs: MUTATION_TIMEOUT_MS });
};

/**
 * Sets the remaining lifetime. `--ttl` is exact, where `--hours N` would
 * replace the remaining time and could shorten a sandbox.
 */
export const extendSandbox = async (sandboxId: string, seconds: number): Promise<void> => {
  await runBoat('extend', [sandboxId, '--ttl', String(Math.max(60, Math.round(seconds)))], {
    timeoutMs: MUTATION_TIMEOUT_MS,
  });
};

/** One hour past the current deadline, so an Extend never shortens a sandbox. */
export const extendSeconds = (sandbox: Sandbox | undefined, now = Date.now()): number => {
  const deadline = sandbox?.archiveAfter ? Date.parse(sandbox.archiveAfter) : Number.NaN;
  const base = Number.isFinite(deadline) && deadline > now ? deadline : now;
  return Math.ceil((base - now) / 1000) + 3_600;
};

export const readDesktopUrl = async (sandboxId: string): Promise<string | null> => {
  const data = await runBoat('desktop', [sandboxId], { timeoutMs: 10_000 });
  if (!isRecord(data)) return null;
  const url = readString(data.desktopUrl) ?? readString(data.viewerUrl);
  return url && /^https?:\/\//i.test(url) ? url : null;
};

/** Starts `boat new` or `boat fork --wait`; the JSONL events are read by `create/jobs.ts`. */export const spawnCreate = (input: CreateInput): ChildProcess => {
  const { command, args } = createCommand(input);
  return spawnBoat(command, args);
};

/** `boat rename <id> <name>`; a fork has no `--name` flag. */
export const renameSandbox = async (sandboxId: string, name: string): Promise<void> => {
  await runBoat('rename', [sandboxId, name], { timeoutMs: 20_000 });
};

