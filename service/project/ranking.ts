/** Remembers which sandboxes matched the last project scope, for quick mention ranking. */
export type ProjectRanking = {
  remember: (directory: string, inProject: Set<string>) => void;
  projectIds: (directory: string) => ReadonlySet<string> | null;
};

const MAX_DIRECTORIES = 8;

export const createProjectRanking = (): ProjectRanking => {
  const byDirectory = new Map<string, Set<string>>();

  return {
    remember: (directory, inProject) => {
      byDirectory.delete(directory);
      byDirectory.set(directory, inProject);
      if (byDirectory.size <= MAX_DIRECTORIES) return;
      const oldest = byDirectory.keys().next().value;
      if (oldest) byDirectory.delete(oldest);
    },
    projectIds: (directory) => byDirectory.get(directory) ?? null,
  };
};
