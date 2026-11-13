import { errorBody, type ConversationsResponse } from '../../shared/routes.ts';
import type { ServiceContext } from '../context.ts';
import { describeFailure } from '../failures.ts';
import { route, type Route } from '../router.ts';
import { isSandboxId } from '../validation.ts';

type Deps = Pick<ServiceContext, 'conversations'>;

export const conversationRoutes = (deps: Deps): Route[] => [
  route('GET', '/conversations', async (context) => {
    const sandboxId = context.search.get('sandbox');
    if (!isSandboxId(sandboxId)) return context.reply(400, errorBody('Unknown sandbox id.'));

    try {
      const body: ConversationsResponse = {
        conversations: await deps.conversations.get(sandboxId),
        now: Date.now(),
      };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
];
