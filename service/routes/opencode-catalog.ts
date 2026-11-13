/** The agents, providers and models a sandbox's OpenCode server offers. */
import {
  errorBody,
  type OpencodeCatalogResponse,
} from '../../shared/routes.ts';
import type { ServiceContext } from '../context.ts';
import { describeFailure } from '../failures.ts';
import { readCatalog } from '../opencode/reads.ts';
import { route, type Route } from '../router.ts';
import { isSandboxId } from '../validation.ts';

type Deps = Pick<ServiceContext, 'opencode'>;

export const opencodeCatalogRoutes = (deps: Deps): Route[] => [
  route('GET', '/opencode/catalog', async (context) => {
    const sandboxId = context.search.get('sandbox');
    if (!isSandboxId(sandboxId)) return context.reply(400, errorBody('Unknown sandbox id.'));

    try {
      const result = await deps.opencode.run(sandboxId, async (connection) => ({
        ...await readCatalog(connection),
        directory: connection.directory,
        directories: connection.directories,
      }));
      const body: OpencodeCatalogResponse = { ...result, now: Date.now() };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
];
