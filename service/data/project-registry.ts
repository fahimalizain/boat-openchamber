/**
 * The OpenChamber projects this service should mark. The panel reports the
 * registered list (the service cannot ask for it), and status requests add the
 * open directory. Persisted in the home folder, never inside the package: a
 * write there reloads the extension.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

import { isRecord } from '../../shared/json.ts';

const MAX_PROJECTS = 24;
const DEFAULT_FILE = join(homedir(), '.boat-openchamber', 'projects.json');

export type ProjectRegistry = {
  list: () => string[];
  /** Adds directories seen in a request. */
  remember: (directories: Array<string | null | undefined>) => void;
  /** Replaces the list with the panel's registered projects; true when it changed. */
  replace: (directories: string[]) => boolean;
};

const usable = (directory: string | null | undefined): directory is string => (
  typeof directory === 'string'
  && isAbsolute(directory)
  && !directory.includes('\0')
  && directory.length <= 1_024
);

const read = (file: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isRecord(parsed) || !Array.isArray(parsed.directories)) return [];
    return parsed.directories.filter(usable).slice(0, MAX_PROJECTS);
  } catch {
    return [];
  }
};

export const createProjectRegistry = (options: { file?: string } = {}): ProjectRegistry => {
  const file = options.file ?? DEFAULT_FILE;
  const directories = new Set<string>(read(file));

  const save = (): void => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ directories: [...directories] }, null, 2));
    } catch {
      // Marks still work for this process.
    }
  };

  return {
    list: () => [...directories],
    remember: (incoming) => {
      let changed = false;
      for (const directory of incoming) {
        if (!usable(directory) || directories.has(directory)) continue;
        if (directories.size >= MAX_PROJECTS) break;
        directories.add(directory);
        changed = true;
      }
      if (changed) save();
    },
    replace: (incoming) => {
      const next = [...new Set(incoming.filter(usable))].slice(0, MAX_PROJECTS);
      const unchanged = next.length === directories.size
        && next.every((directory) => directories.has(directory));
      if (unchanged) return false;

      directories.clear();
      for (const directory of next) directories.add(directory);
      save();
      return true;
    },
  };
};
