/**
 * A small typed wrapper over the `boat` CLI.
 *
 * Everything goes through `execFile` with an argv array (never a shell string),
 * always with `--json --no-update` plus `BOAT_NO_UPDATE=1`. The CLI is resolved
 * without relying on the user's environment: PATH first, then known install
 * locations, then `BOAT_BIN` as an override.
 */
import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export type BoatErrorCode = 'missing-cli' | 'not-signed-in' | 'command-failed';

export class BoatError extends Error {
  readonly code: BoatErrorCode;

  constructor(code: BoatErrorCode, message: string) {
    super(message);
    this.name = 'BoatError';
    this.code = code;
  }
}

/** The states `boat list` reports. Kept open because the CLI may add more. */
export type SandboxState =
  | 'provisioned'
  | 'cloning'
  | 'ready'
  | 'idle'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'
  | (string & {});

export type Sandbox = {
  id: string;
  name: string;
  state: SandboxState;
  /** Machine type: small, default, large or xlarge. */
  type: string | null;
  vcpu: number | null;
  memoryGB: number | null;
  createdAt: string | null;
  /** When the sandbox's current lifetime runs out; null when it never auto-stops. */
  archiveAfter: string | null;
  stoppedAt: string | null;
  /** Stable app URL for the sandbox subdomain. */
  url: string | null;
  ttlSeconds: number | null;
  desktopAvailable: boolean;
  environment: string | null;
  health: string | null;
  sshEndpoint: string | null;
};

export type Conversation = {
  id: string | null;
  running: boolean;
};

export type PlanLimits = {
  canStart: boolean;
  blockedReason: string | null;
  active: number | null;
  maxActive: number | null;
};

export type RunOptions = {
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const MUTATION_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim().length > 0 ? value : null
);

const readNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

/** JSON, or JSONL as several `boat` commands print it. */
const parseJsonOutput = (output: string): unknown => {
  const text = output.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Fall through to JSONL.
  }
  const items: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch {
      // A human log line inside JSONL output; skip it.
    }
  }
  return items.length > 0 ? items : null;
};

const errorMessage = (stdout: string, stderr: string, fallback: string): string => {
  const parsed = parseJsonOutput(stdout) ?? parseJsonOutput(stderr);
  const record = isRecord(parsed) ? parsed : Array.isArray(parsed) && isRecord(parsed[0]) ? parsed[0] : null;
  if (record) {
    const nested = isRecord(record.error) ? record.error : null;
    const message = readString(nested?.message) ?? readString(record.message) ?? readString(record.error);
    if (message) return message;
  }
  const lines = [stderr, stdout].flatMap((stream) => stream.split(/\r?\n/).map((line) => line.trim()));
  return lines.find(Boolean) ?? fallback;
};

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const onPath = (name: string): string | null => {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
};

let resolvedBinary: string | null | undefined;

/**
 * The `boat` binary, or null when it is not installed. The service gets no user
 * environment, so a bare `boat` on PATH cannot be assumed; the ASCII installer
 * location is checked too.
 */
export const boatBinary = (): string | null => {
  if (resolvedBinary !== undefined) return resolvedBinary;
  const candidates = [
    process.env.BOAT_BIN?.trim(),
    onPath('boat'),
    join(homedir(), '.ascii', 'bin', 'boat'),
    '/opt/homebrew/bin/boat',
    '/usr/local/bin/boat',
  ].filter((candidate): candidate is string => Boolean(candidate));
  resolvedBinary = candidates.find(isExecutable) ?? null;
  return resolvedBinary;
};

/** Drop the memoized path, so a newly installed CLI is picked up. */
export const resetBoatBinary = (): void => {
  resolvedBinary = undefined;
};

const run = async (command: string, args: string[], options: RunOptions = {}): Promise<unknown> => {
  const binary = boatBinary();
  if (!binary) {
    throw new BoatError('missing-cli', 'The boat CLI was not found. Install it from https://docs.boat.dev and restart this extension.');
  }
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      binary,
      [command, '--json', '--no-update', ...args],
      {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, BOAT_NO_UPDATE: '1' },
      },
      (error, out, err) => {
        if (!error) {
          resolve(out);
          return;
        }
        const message = error.killed
          ? `boat ${command} did not finish in ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s.`
          : errorMessage(out, err, error.message || 'The boat CLI failed.');
        const code: BoatErrorCode = /not signed in|signed out|session expired|boat login/i.test(message)
          ? 'not-signed-in'
          : 'command-failed';
        reject(new BoatError(code, message));
      },
    );
  });
  return parseJsonOutput(stdout);
};

export const listSandboxes = async (): Promise<Sandbox[]> => {
  const data = await run('list', ['--all']);
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.sandboxes)
      ? data.sandboxes
      : [];
  return rows.filter(isRecord).flatMap((row) => {
    const id = readString(row.id);
    if (!id) return [];
    return [{
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
    }];
  });
};

export const stopSandbox = async (id: string): Promise<void> => {
  await run('stop', [id, '--yes'], { timeoutMs: MUTATION_TIMEOUT_MS });
};

export const resumeSandbox = async (id: string): Promise<void> => {
  await run('resume', [id, '--no-wait'], { timeoutMs: MUTATION_TIMEOUT_MS });
};

/**
 * Sets the sandbox's remaining lifetime. `--ttl` is exact, where `--hours N`
 * would replace the remaining time and could shorten a sandbox.
 */
export const extendSandbox = async (id: string, seconds: number): Promise<void> => {
  await run('extend', [id, '--ttl', String(Math.max(60, Math.round(seconds)))], { timeoutMs: MUTATION_TIMEOUT_MS });
};

export const desktopUrl = async (id: string): Promise<string | null> => {
  const data = await run('desktop', [id], { timeoutMs: 10_000 });
  if (!isRecord(data)) return null;
  const url = readString(data.desktopUrl) ?? readString(data.viewerUrl);
  return url && /^https?:\/\//i.test(url) ? url : null;
};

export const listConversations = async (id: string): Promise<Conversation[]> => {
  const data = await run('conversations', [id], { timeoutMs: 10_000 });
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.conversations)
      ? data.conversations
      : [];
  return rows.filter(isRecord).map((row) => ({
    id: readString(row.id) ?? readString(row.conversationId),
    running:
      row.running === true
      || row.isRunning === true
      || row.active === true
      || readString(row.state) === 'running'
      || readString(row.status) === 'running',
  }));
};

export const readLimits = async (): Promise<PlanLimits> => {
  const data = await run('limits', [], { timeoutMs: 15_000 });
  const record = isRecord(data) ? data : {};
  return {
    canStart: record.canStart !== false,
    blockedReason: readString(record.blockedReason) ?? readString(record.startBlockedReason),
    active: readNumber(record.activeSandboxes),
    maxActive: readNumber(record.maxActiveSandboxes),
  };
};
