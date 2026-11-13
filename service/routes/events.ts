import { errorBody, type HistoryResponse, type OkBody, type WatchRequest } from '../../shared/routes.ts';
import type { ServiceContext } from '../context.ts';
import { listEvents } from '../domain/events.ts';
import { describeFailure } from '../failures.ts';
import { route, type Route } from '../router.ts';
import { isConversationId, isSandboxId } from '../validation.ts';

type Deps = Pick<ServiceContext, 'followers' | 'conversations'>;

const HISTORY_MAX = 200;

export const eventRoutes = (deps: Deps): Route[] => [
  route('GET', '/history', async (context) => {
    const sandboxId = context.search.get('sandbox');
    const conversationId = context.search.get('conversation');
    if (!isSandboxId(sandboxId) || !isConversationId(conversationId)) {
      return context.reply(400, errorBody('Unknown sandbox or conversation.'));
    }

    try {
      const events = await listEvents(sandboxId, conversationId);
      const known = deps.conversations.peek(sandboxId)?.find((entry) => entry.id === conversationId);
      const body: HistoryResponse = {
        events: events.length > HISTORY_MAX ? events.slice(events.length - HISTORY_MAX) : events,
        running: known?.running ?? null,
        now: Date.now(),
      };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  /** Starts the follower, and is also the panel's keep-alive while it watches. */
  route('POST', '/watch', async (context) => {
    const body = await context.json<WatchRequest>();
    if (!body || !isSandboxId(body.sandbox) || !isConversationId(body.conversation)) {
      return context.reply(400, errorBody('Unknown sandbox or conversation.'));
    }
    try {
      deps.followers.watch(body.sandbox, body.conversation);
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('POST', '/unwatch', async (context) => {
    const body = await context.json<WatchRequest>();
    if (body && isSandboxId(body.sandbox) && isConversationId(body.conversation)) {
      deps.followers.unwatch(body.sandbox, body.conversation);
    }
    const answer: OkBody = { ok: true };
    return context.reply(200, answer);
  }),
];
