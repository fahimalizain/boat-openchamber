/** The composer's `@` menu: sandboxes and their cached conversations. */
import {
  MENTIONS_RESOLVE_PATH,
  MENTIONS_SEARCH_PATH,
  type MentionsItem,
  type MentionsResolveRequest,
  type MentionsResolveResult,
  type MentionsSearchRequest,
  type MentionsSearchResult,
} from '@openchamber/sdk';

import { readString } from '../../shared/json.ts';
import { isUpState } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { listConversations } from '../domain/conversations.ts';
import { listEvents } from '../domain/events.ts';
import { describeFailure } from '../failures.ts';
import { renderConversationMention, renderSandboxMention } from '../mentions/render.ts';
import { mentionRows, parseMentionId } from '../mentions/rows.ts';
import { route, type Route } from '../router.ts';

type Deps = Pick<ServiceContext, 'sandboxes' | 'conversations' | 'agents' | 'ranking'>;

export const mentionRoutes = (deps: Deps): Route[] => [
  route('POST', MENTIONS_SEARCH_PATH, async (context) => {
    const body = await context.json<MentionsSearchRequest>();
    const directory = readString(body?.directory);

    try {
      // The list is cached for a few seconds; a cold service pays one `boat list`.
      const snapshot = deps.sandboxes.peek() ?? await deps.sandboxes.get();
      for (const sandbox of snapshot.sandboxes) {
        if (isUpState(sandbox.state)) deps.agents.check(sandbox.id);
      }

      const items: MentionsItem[] = mentionRows({
        sandboxes: snapshot.sandboxes,
        conversations: (sandboxId) => deps.conversations.peek(sandboxId),
        projectIds: directory ? deps.ranking.projectIds(directory) : null,
        query: readString(body?.query) ?? '',
      });
      const answer: MentionsSearchResult = { items };
      return context.reply(200, answer);
    } catch {
      // The menu never shows an error; the next keystroke tries again.
      const answer: MentionsSearchResult = { items: [] };
      return context.reply(200, answer);
    }
  }),

  route('POST', MENTIONS_RESOLVE_PATH, async (context) => {
    const body = await context.json<MentionsResolveRequest>();
    const mention = parseMentionId(readString(body?.id));
    if (!mention) return context.reply(400, { error: 'Unknown mention.' });

    const snapshot = deps.sandboxes.peek() ?? await deps.sandboxes.get();
    const sandbox = snapshot.sandboxes.find((entry) => entry.id === mention.sandboxId) ?? null;

    try {
      if (mention.kind === 'sandbox') {
        if (!sandbox) return context.reply(404, { error: 'That sandbox is not in the list any more.' });
        const conversations = deps.conversations.peek(sandbox.id) ?? await listConversations(sandbox.id);
        const answer: MentionsResolveResult = { text: renderSandboxMention(sandbox, conversations) };
        return context.reply(200, answer);
      }

      const cached = deps.conversations.peek(mention.sandboxId);
      const conversation = cached?.find((entry) => entry.id === mention.conversationId) ?? null;
      const events = await listEvents(mention.sandboxId, mention.conversationId, { timeoutMs: 8_000 });
      const answer: MentionsResolveResult = {
        text: renderConversationMention({
          sandbox,
          sandboxId: mention.sandboxId,
          conversationId: mention.conversationId,
          conversation,
          events,
        }),
      };
      return context.reply(200, answer);
    } catch (failure) {
      return context.reply(502, { error: describeFailure(failure).text });
    }
  }),
];
