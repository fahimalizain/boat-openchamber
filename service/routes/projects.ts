/** The panel reports the registered projects; the service marks them. */
import type { ProjectsRequest } from '../../shared/routes.ts';
import type { ProjectRegistry } from '../data/project-registry.ts';
import { route, type Route } from '../router.ts';

export const projectRoutes = (deps: { projects: ProjectRegistry; onChanged: () => void }): Route[] => [
  route('POST', '/projects', async (context) => {
    const body = await context.json<ProjectsRequest>();
    const directories = Array.isArray(body?.directories)
      ? body.directories.filter((entry): entry is string => typeof entry === 'string')
      : [];

    if (deps.projects.replace(directories)) deps.onChanged();
    return context.reply(200, { ok: true });  }),
];
