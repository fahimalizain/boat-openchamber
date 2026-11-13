/** The agents and models the composer offers, from boat's public catalogue. */
import type { AgentDto } from '../../shared/routes.ts';
import type { ServiceContext } from '../context.ts';
import { agentOptions } from '../data/agent-catalog.ts';
import { describeFailure } from '../failures.ts';
import { route, type Route } from '../router.ts';

type Deps = Pick<ServiceContext, 'catalog' | 'credentials'>;

export const agentCatalogRoutes = (deps: Deps): Route[] => [
  route('GET', '/agents', async (context) => {
    try {
      const [catalog, connected] = await Promise.all([deps.catalog.get(), deps.credentials.get()]);
      const agents: AgentDto[] = agentOptions(catalog.agents, connected === null ? null : new Set(connected));
      return context.reply(200, agents);
    } catch (failure) {
      return context.reply(502, { error: describeFailure(failure).text });
    }
  }),
];
