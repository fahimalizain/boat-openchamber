/** The prompts a running session still holds: list, drop, and steer⇄queue. */
import { readString } from '../../shared/json.ts';
import {
  errorBody,
  type OpencodeInboxCancelRequest,
  type OpencodeInboxResponse,
  type OpencodeInboxUpdateRequest,
} from '../../shared/routes.ts';
import type { ServiceContext } from '../context.ts';
import { describeFailure } from '../failures.ts';
import { readInbox } from '../opencode/reads.ts';
import { route, type Route } from '../router.ts';
import { isOpencodeRequestId, isOpencodeSessionId, isSandboxId } from '../validation.ts';

type Deps = Pick<ServiceContext, 'opencode'>;

export const opencodeInboxRoutes = (deps: Deps): Route[] => [
  route('GET', '/opencode/inbox', async (context) => {
    const sandboxId = context.search.get('sandbox');
    const sessionId = context.search.get('session');
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId)) {
      return context.reply(400, errorBody('Unknown sandbox or session.'));
    }

    try {
      const entries = await deps.opencode.run(sandboxId, (connection) => readInbox(connection, sessionId));
      const body: OpencodeInboxResponse = { entries, now: Date.now() };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('POST', '/opencode/inbox/cancel', async (context) => {
    const body = await context.json<OpencodeInboxCancelRequest>();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    const inboxId = readString(body?.inbox);
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId) || !isOpencodeRequestId(inboxId)) {
      return context.reply(400, errorBody('Unknown sandbox, session or inbox entry.'));
    }

    try {
      await deps.opencode.run(sandboxId, (connection) => (
        connection.client.session.inbox.cancel({ sessionID: sessionId, inboxID: inboxId })
      ));
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('POST', '/opencode/inbox/update', async (context) => {
    const body = await context.json<OpencodeInboxUpdateRequest>();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    const inboxId = readString(body?.inbox);
    const delivery = body?.delivery;
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId) || !isOpencodeRequestId(inboxId)) {
      return context.reply(400, errorBody('Unknown sandbox, session or inbox entry.'));
    }
    if (delivery !== 'steer' && delivery !== 'queue') {
      return context.reply(400, errorBody('Unknown delivery.'));
    }

    try {
      await deps.opencode.run(sandboxId, (connection) => (
        connection.client.session.inbox.update({ sessionID: sessionId, inboxID: inboxId, delivery })
      ));
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
];
