/** Prompting, steering and interrupting the agent inside a sandbox. */
import readline from 'node:readline';

import { isRecord, readString } from '../../shared/json.ts';
import type { PromptStart } from '../../shared/routes.ts';
import { BoatError, parseBoatJson, runBoat, spawnBoat } from '../boat.ts';
import { promptCommand, type PromptOptions } from './prompt-argv.ts';

export type { PromptOptions };

const MUTATION_TIMEOUT_MS = 20_000;
const EARLY_RETURN_MS = 2_500;

/**
 * Sends a prompt and returns as soon as the CLI names the conversation, or
 * after a short grace period. `boat prompt` itself runs until the turn ends, so
 * it is left in the background instead of holding the request.
 */
export const promptSandbox = (sandboxId: string, text: string, options: PromptOptions): Promise<PromptStart> => (
  new Promise((resolve, reject) => {
    const args = promptCommand(sandboxId, text, options);

    const child = spawnBoat('prompt', args);
    const stdout = child.stdout;
    if (!stdout) {
      child.kill('SIGTERM');
      reject(new BoatError('command-failed', 'boat prompt did not open its output.'));
      return;
    }

    let conversationId: string | null = null;
    let stdoutError: string | null = null;
    let stderr = '';
    let settled = false;

    const finish = (value: PromptStart): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      const notSignedIn = /not signed in|signed out|session expired|boat login/i.test(message);
      reject(new BoatError(notSignedIn ? 'not-signed-in' : 'command-failed', message));
    };

    const lines = readline.createInterface({ input: stdout });
    lines.on('line', (line) => {
      const raw = parseBoatJson(line);
      if (!isRecord(raw)) return;
      const nested = isRecord(raw.error) ? raw.error : null;
      const errorText = readString(nested?.message)
        ?? readString(raw.error)
        ?? (raw.event === 'error' ? readString(raw.message) : null);
      if (errorText) stdoutError = errorText;
      const data = isRecord(raw.data) ? raw.data : null;
      conversationId = readString(raw.conversationId) ?? readString(data?.conversationId) ?? conversationId;
      if (conversationId) finish({ conversationId, pending: true });
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4_000);
    });
    child.on('error', (error) => fail(error.message));
    child.on('close', (code) => {
      if (code === 0) {
        finish({ conversationId, pending: false });
        return;
      }
      const detail = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-2).join(' ')
        || stdoutError
        || `boat prompt exited with code ${code ?? 'unknown'}.`;
      fail(detail);
    });

    setTimeout(() => finish({ conversationId, pending: true }), EARLY_RETURN_MS).unref();
  })
);

export const steerSandbox = async (sandboxId: string, conversationId: string, text: string): Promise<void> => {
  await runBoat('steer', [sandboxId, '--convo', conversationId, '--', text], { timeoutMs: MUTATION_TIMEOUT_MS });
};

export const interruptSandbox = async (sandboxId: string, conversationId: string): Promise<void> => {
  await runBoat('interrupt', [sandboxId, '--convo', conversationId], { timeoutMs: MUTATION_TIMEOUT_MS });
};
