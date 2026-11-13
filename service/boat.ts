/**
 * The `boat` CLI adapter: binary lookup, argv execution, JSON parsing. It knows
 * nothing about sandboxes or OpenCode.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import { isRecord, readString } from '../shared/json.ts';

export type BoatErrorCode = 'missing-cli' | 'not-signed-in' | 'command-failed';

export class BoatError extends Error {
  readonly code: BoatErrorCode;

  constructor(code: BoatErrorCode, message: string) {
    super(message);
    this.name = 'BoatError';
    this.code = code;
  }
}

export type RunOptions = { timeoutMs?: number };

export const MISSING_CLI_MESSAGE =
  'The boat CLI was not found. Install it from https://docs.boat.dev and restart this extension.';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** JSON, or JSONL as create and fork progress prints it. */
export const parseBoatJson = (output: string): unknown => {
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

export type BoatLine = {
  /** The line's own fields, with the envelope's event name folded in. */
  value: Record<string, unknown>;
  event: string | null;
  /** The envelope's `final` flag, when the command prints one. */
  final: boolean | null;
};

/**
 * Some commands wrap each JSONL line as `{ event, data }` (`boat new`, create
 * progress). Unwrap once here; flat lines pass through unchanged. An event's
 * own `data` field does not make it an envelope: the wrapper always carries an
 * `event` name.
 */
export const readBoatLine = (raw: unknown): BoatLine | null => {
  if (!isRecord(raw)) return null;
  const event = readString(raw.event);
  const final = typeof raw.final === 'boolean' ? raw.final : null;
  const data = isRecord(raw.data) ? raw.data : null;
  if (event && data) {
    return { value: { ...data, event }, event, final };
  }
  return { value: raw, event, final };
};

const errorMessage = (stdout: string, stderr: string, fallback: string): string => {
  const parsed = parseBoatJson(stdout) ?? parseBoatJson(stderr);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const record = readBoatLine(first)?.value ?? null;
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

let cachedBinary: string | null = null;

/**
 * The `boat` binary, or null when it is not installed. The service gets no user
 * environment, so a bare `boat` on PATH cannot be assumed; the ASCII installer
 * location is checked too. A miss is not cached, so installing the CLI later
 * starts working without a restart.
 */
export const boatBinary = (): string | null => {
  if (cachedBinary) return cachedBinary;
  const candidates = [
    process.env.BOAT_BIN?.trim(),
    onPath('boat'),
    join(homedir(), '.ascii', 'bin', 'boat'),
    '/opt/homebrew/bin/boat',
    '/usr/local/bin/boat',
  ].filter((candidate): candidate is string => Boolean(candidate));
  cachedBinary = candidates.find(isExecutable) ?? null;
  return cachedBinary;
};

const requireBinary = (): string => {
  const binary = boatBinary();
  if (!binary) throw new BoatError('missing-cli', MISSING_CLI_MESSAGE);
  return binary;
};

/** The CLI's environment: the service's own, plus the update opt-out. */
export const boatEnv = (): NodeJS.ProcessEnv => ({ ...process.env, BOAT_NO_UPDATE: '1' });

/** Runs one command with `--json --no-update` and returns its parsed output. */
export const runBoat = async (command: string, args: string[], options: RunOptions = {}): Promise<unknown> => {
  const binary = requireBinary();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      binary,
      [command, '--json', '--no-update', ...args],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, env: boatEnv() },
      (error, out, err) => {
        if (!error) {
          resolve(out);
          return;
        }
        const message = error.killed
          ? `boat ${command} did not finish in ${Math.round(timeoutMs / 1000)}s.`
          : errorMessage(out, err, error.message || 'The boat CLI failed.');
        const code: BoatErrorCode = /not signed in|signed out|session expired|boat login/i.test(message)
          ? 'not-signed-in'
          : 'command-failed';
        reject(new BoatError(code, message));
      },
    );
  });
  return parseBoatJson(stdout);
};

/** Starts a streaming command (`boat new`, `boat fork`) the service reads line by line. */
export const spawnBoat = (command: string, args: string[]): ChildProcess => (
  spawn(requireBinary(), [command, '--json', '--no-update', ...args], {
    env: boatEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
);
