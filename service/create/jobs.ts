/** Runs one create at a time and reports it over `boat:create`. */
import readline from 'node:readline';
import type { ChildProcess } from 'node:child_process';

import type { CreateProgress } from '../../shared/routes.ts';
import { BoatError, parseBoatJson } from '../boat.ts';
import type { CreateInput } from '../domain/sandboxes.ts';
import { parseCreateLine } from './progress.ts';

export type CreateJobs = {
  busy: () => boolean;
  start: (input: CreateInput) => void;
};

export const createCreateJobs = (deps: {
  spawn: (input: CreateInput) => ChildProcess;
  emit: (progress: CreateProgress) => void;
  onCreated: (sandboxId: string) => void;
  onReady: (sandboxId: string) => void;
}): CreateJobs => {
  let child: ChildProcess | null = null;

  const start = (input: CreateInput): void => {
    if (child) throw new BoatError('command-failed', 'A sandbox is already being created.');

    const running = deps.spawn(input);
    child = running;

    let sandboxId: string | null = null;
    let failure: string | null = null;
    let stderr = '';
    deps.emit({ state: 'starting' });

    const stdout = running.stdout;
    if (!stdout) {
      running.kill('SIGTERM');
      child = null;
      deps.emit({ state: 'failed', message: 'boat did not open its output.' });
      return;
    }

    const lines = readline.createInterface({ input: stdout });
    lines.on('line', (line) => {
      const parsed = parseCreateLine(parseBoatJson(line));
      if (!parsed) return;
      if (parsed.sandboxId && parsed.sandboxId !== sandboxId) {
        sandboxId = parsed.sandboxId;
        deps.onCreated(parsed.sandboxId);
        deps.emit({ state: 'created', sandboxId: parsed.sandboxId });
      }
      if (parsed.failure) failure = parsed.failure;
    });

    running.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2_000);
    });

    running.on('error', (error) => {
      child = null;
      deps.emit({ state: 'failed', message: error.message });
    });

    running.on('close', (code) => {
      child = null;
      if (failure) {
        deps.emit({ state: 'failed', message: failure });
        return;
      }
      if (code === 0 && sandboxId) {
        deps.onReady(sandboxId);
        deps.emit({ state: 'ready', sandboxId });
        return;
      }
      if (code === 0) {
        deps.emit({ state: 'failed', message: 'boat finished without a sandbox id.' });
        return;
      }
      const detail = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-1)[0];
      deps.emit({ state: 'failed', message: detail ?? `boat exited with code ${code ?? 'unknown'}.` });
    });
  };

  return { busy: () => child !== null, start };
};
