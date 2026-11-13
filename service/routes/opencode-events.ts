/** Starts and stops the per-sandbox OpenCode event relay; watch is also the ping. */
import { errorBody, type OkBody, type OpencodeWatchRequest } from '../../shared/routes.ts';
import type { ServiceContext } from '../context.ts';
import { describeFailure } from '../failures.ts';
import { route, type Route } from '../router.ts';
import { isSandboxId } from '../validation.ts';

type Deps = Pick<ServiceContext, 'opencodeFollowers'>;

export const opencodeEventRoutes = (deps: Deps): Route[] => [
  route('POST', '/opencode/watch', async (context) => {
    const body = await context.json<OpencodeWatchRequest>();
    if (!body || !isSandboxId(body.sandbox)) {
      return context.reply(400, errorBody('Unknown sandbox id.'));
    }
    try {
      deps.opencodeFollowers.watch(body.sandbox);
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('POST', '/opencode/unwatch', async (context) => {
    const body = await context.json<OpencodeWatchRequest>();
    if (body && isSandboxId(body.sandbox)) deps.opencodeFollowers.unwatch(body.sandbox);
    const answer: OkBody = { ok: true };
    return context.reply(200, answer);
  }),
];
