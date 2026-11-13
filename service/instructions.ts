/** Keeps the host's instructions in step with the sandbox list, globally and per project. */
import type { SandboxSnapshot } from './data/sandbox-list.ts';
import { buildInstructions } from './status/text.ts';

export type InstructionsWriter = {
  sync: (snapshot: SandboxSnapshot) => Promise<void>;
  /** Write text scoped to one project directory. */
  syncProject: (directory: string, text: string) => Promise<void>;
};

const MAX_PROJECTS = 8;

export const createInstructionsWriter = (options: {
  setInstructions: (directory: string | null, text: string) => Promise<unknown>;
  retryMs: number;
}): InstructionsWriter => {
  let globalSent: string | null = null;
  let globalRetryAt = 0;

  const projectSent = new Map<string, string>();
  const projectRetryAt = new Map<string, number>();

  const rememberProject = (directory: string, text: string): void => {
    projectSent.delete(directory);
    projectSent.set(directory, text);
    if (projectSent.size <= MAX_PROJECTS) return;
    const oldest = projectSent.keys().next().value;
    if (oldest) projectSent.delete(oldest);
  };

  return {
    sync: async (snapshot) => {
      const text = buildInstructions(snapshot.sandboxes, Date.now(), snapshot.failure?.text ?? null);
      if (text === globalSent || Date.now() < globalRetryAt) return;
      try {
        await options.setInstructions(null, text);
        globalSent = text;
      } catch {
        // Running outside OpenChamber, or the host has not granted instructions yet.
        globalRetryAt = Date.now() + options.retryMs;
      }
    },

    syncProject: async (directory, text) => {
      if (projectSent.get(directory) === text) return;
      if (Date.now() < (projectRetryAt.get(directory) ?? 0)) return;
      try {
        await options.setInstructions(directory, text);
        projectRetryAt.delete(directory);
        rememberProject(directory, text);
      } catch {
        projectRetryAt.set(directory, Date.now() + options.retryMs);
      }
    },
  };
};
