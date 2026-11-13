/** Keeps the host's instructions in step with the sandbox list. */
import type { SandboxSnapshot } from './data/sandbox-list.ts';
import { buildInstructions } from './status/text.ts';

export type InstructionsWriter = {
  sync: (snapshot: SandboxSnapshot) => Promise<void>;
};

export const createInstructionsWriter = (options: {
  setInstructions: (directory: string | null, text: string) => Promise<unknown>;
  retryMs: number;
}): InstructionsWriter => {
  let sent: string | null = null;
  let retryAt = 0;

  return {
    sync: async (snapshot) => {
      const text = buildInstructions(snapshot.sandboxes, Date.now(), snapshot.failure?.text ?? null);
      if (text === sent || Date.now() < retryAt) return;
      try {
        await options.setInstructions(null, text);
        sent = text;
      } catch {
        // Running outside OpenChamber, or the host has not granted instructions yet.
        retryAt = Date.now() + options.retryMs;
      }
    },
  };
};
