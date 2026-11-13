/** Sessions and history for a sandbox's OpenCode server. */
import { readString } from '../../shared/json.ts';
import {
  errorBody,
  type OpencodeCreateSessionRequest,
  type OpencodeMessagesResponse,
  type OpencodeSessionResponse,
  type OpencodeSessionsResponse,
} from '../../shared/routes.ts';
import type { ServiceContext } from '../context.ts';
import { describeFailure } from '../failures.ts';
import { normalizeSession, toModelRefInput } from '../opencode/normalize.ts';
import {
  readPermissions,
  readQuestions,
  readSession,
  readSessionMessages,
  readSessions,
} from '../opencode/reads.ts';
import { route, type Route } from '../router.ts';
import {
  isAbsoluteDirectory,
  isOpencodeName,
  isOpencodeSessionId,
  isSandboxId,
  MAX_TITLE_CHARS,
  readOpencodeModelRef,
} from '../validation.ts';

type Deps = Pick<ServiceContext, 'opencode'>;

export const opencodeSessionRoutes = (deps: Deps): Route[] => [
  route('GET', '/opencode/sessions', async (context) => {
    const sandboxId = context.search.get('sandbox');
    if (!isSandboxId(sandboxId)) return context.reply(400, errorBody('Unknown sandbox id.'));
    const requested = context.search.get('directory');
    if (requested !== null && !isAbsoluteDirectory(requested)) {
      return context.reply(400, errorBody('Unknown directory.'));
    }

    try {
      const result = await deps.opencode.run(sandboxId, async (connection) => ({
        sessions: await readSessions(connection, requested),
        directory: connection.directory,
        directories: connection.directories,
      }));
      const body: OpencodeSessionsResponse = { ...result, now: Date.now() };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('GET', '/opencode/messages', async (context) => {
    const sandboxId = context.search.get('sandbox');
    const sessionId = context.search.get('session');
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId)) {
      return context.reply(400, errorBody('Unknown sandbox or session.'));
    }

    try {
      const result = await deps.opencode.run(sandboxId, async (connection) => {
        const session = await readSession(connection, sessionId);
        if (!session) throw new Error('That OpenCode session no longer exists.');
        const [history, permissions, questions] = await Promise.all([
          readSessionMessages(connection, sessionId),
          readPermissions(connection, sessionId),
          readQuestions(connection, sessionId),
        ]);
        return { session, ...history, permissions, questions };
      });
      const body: OpencodeMessagesResponse = { ...result, now: Date.now() };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('POST', '/opencode/session', async (context) => {
    const body = await context.json<OpencodeCreateSessionRequest>();
    const sandboxId = readString(body?.sandbox);
    if (!isSandboxId(sandboxId)) return context.reply(400, errorBody('Unknown sandbox id.'));

    const directory = readString(body?.directory);
    if (directory !== null && !isAbsoluteDirectory(directory)) {
      return context.reply(400, errorBody('Unknown directory.'));
    }
    const title = readString(body?.title);
    if (title && title.length > MAX_TITLE_CHARS) {
      return context.reply(400, errorBody('That session title is too long.'));
    }
    const agent = readString(body?.agent);
    if (agent && !isOpencodeName(agent)) return context.reply(400, errorBody('Unknown agent.'));
    const model = body?.model === undefined ? null : readOpencodeModelRef(body.model);
    if (body?.model !== undefined && !model) {
      return context.reply(400, errorBody('Unknown model.'));
    }

    try {
      const session = await deps.opencode.run(sandboxId, async (connection) => {
        const raw: unknown = await connection.client.session.create({
          ...(title ? { title } : {}),
          ...(agent ? { agent } : {}),
          ...(model ? { model: toModelRefInput(model) } : {}),
          location: { directory: directory ?? connection.directory },
        });
        return normalizeSession(raw);
      });
      if (!session) throw new Error('OpenCode created a session with no id.');
      const answer: OpencodeSessionResponse = { session };
      return context.reply(200, answer);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
];
