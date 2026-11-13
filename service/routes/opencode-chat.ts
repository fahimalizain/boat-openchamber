/** Prompts, interrupts and the two kinds of OpenCode requests the panel answers. */
import { isRecord, readString } from '../../shared/json.ts';
import {
  errorBody,
  type OpencodeAbortRequest,
  type OpencodeAbortResponse,
  type OpencodePermissionReplyRequest,
  type OpencodePromptRequest,
  type OpencodePromptResponse,
  type OpencodeQuestionReplyRequest,
} from '../../shared/routes.ts';
import type { OpencodeModelRef, OpencodeQuestionAnswer } from '../../shared/opencode.ts';
import type { ServiceContext } from '../context.ts';
import { describeFailure } from '../failures.ts';
import { normalizeSession, toModelRefInput } from '../opencode/normalize.ts';
import { route, type Route } from '../router.ts';
import {
  isOpencodeName,
  isOpencodeRequestId,
  isOpencodeSessionId,
  isSandboxId,
  MAX_PROMPT_CHARS,
  readOpencodeModelRef,
} from '../validation.ts';

type Deps = Pick<ServiceContext, 'opencode'>;

const isDecision = (value: unknown): value is 'once' | 'always' | 'reject' => (
  value === 'once' || value === 'always' || value === 'reject'
);

const sameModel = (left: OpencodeModelRef | null, right: OpencodeModelRef): boolean => (
  left !== null
  && left.id === right.id
  && left.providerID === right.providerID
  && (right.variant === null || left.variant === right.variant)
);

/** Validates an answer object; unknown value shapes are dropped, not coerced. */
const readAnswer = (value: unknown): Record<string, OpencodeQuestionAnswer> | null => {
  if (!isRecord(value)) return null;
  const answer: Record<string, OpencodeQuestionAnswer> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(key)) continue;
    if (typeof entry === 'string') {
      if (entry.length <= 5_000) answer[key] = entry;
    } else if (typeof entry === 'number') {
      if (Number.isFinite(entry)) answer[key] = entry;
    } else if (typeof entry === 'boolean') {
      answer[key] = entry;
    } else if (Array.isArray(entry)) {
      const items = entry.filter((item): item is string => typeof item === 'string' && item.length <= 5_000);
      if (items.length === entry.length) answer[key] = items;
    }
  }
  return Object.keys(answer).length > 0 ? answer : null;
};

export const opencodeChatRoutes = (deps: Deps): Route[] => [
  route('POST', '/opencode/prompt', async (context) => {
    const body = await context.json<OpencodePromptRequest>();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    const text = readString(body?.text);
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId)) {
      return context.reply(400, errorBody('Unknown sandbox or session.'));
    }
    if (!text) return context.reply(400, errorBody('Write a prompt first.'));
    if (text.length > MAX_PROMPT_CHARS) return context.reply(400, errorBody('That prompt is too long.'));

    const agent = readString(body?.agent);
    if (agent && !isOpencodeName(agent)) return context.reply(400, errorBody('Unknown agent.'));
    const model = body?.model === undefined ? null : readOpencodeModelRef(body.model);
    if (body?.model !== undefined && !model) {
      return context.reply(400, errorBody('Unknown model.'));
    }

    try {
      const messageID = await deps.opencode.run(sandboxId, async (connection) => {
        if (agent || model) {
          const raw: unknown = await connection.client.session.get({ sessionID: sessionId });
          const current = normalizeSession(raw);
          if (agent && current?.agent !== agent) {
            await connection.client.session.switchAgent({ sessionID: sessionId, agent });
          }
          if (model && !sameModel(current?.model ?? null, model)) {
            await connection.client.session.switchModel({ sessionID: sessionId, model: toModelRefInput(model) });
          }
        }
        const raw: unknown = await connection.client.session.prompt({ sessionID: sessionId, text });
        return isRecord(raw) ? readString(raw.id) : null;
      });
      const answer: OpencodePromptResponse = { ok: true, sessionID: sessionId, messageID };
      return context.reply(200, answer);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('POST', '/opencode/abort', async (context) => {
    const body = await context.json<OpencodeAbortRequest>();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId)) {
      return context.reply(400, errorBody('Unknown sandbox or session.'));
    }

    try {
      const interrupted = await deps.opencode.run(sandboxId, async (connection) => {
        const raw: unknown = await connection.client.session.interrupt({ sessionID: sessionId });
        return isRecord(raw) && raw.interrupted === true;
      });
      const answer: OpencodeAbortResponse = { ok: true, interrupted };
      return context.reply(200, answer);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('POST', '/opencode/permission', async (context) => {
    const body = await context.json<OpencodePermissionReplyRequest>();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    const requestId = readString(body?.request);
    const decision = body?.decision;
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId) || !isOpencodeRequestId(requestId)) {
      return context.reply(400, errorBody('Unknown sandbox, session or request.'));
    }
    if (!isDecision(decision)) return context.reply(400, errorBody('Unknown permission decision.'));

    const message = readString(body?.message);
    try {
      await deps.opencode.run(sandboxId, async (connection) => {
        await connection.client.permission.reply({
          sessionID: sessionId,
          requestID: requestId,
          decision,
          ...(message ? { message } : {}),
        });
      });
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('POST', '/opencode/question', async (context) => {
    const body = await context.json<OpencodeQuestionReplyRequest>();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    const questionId = readString(body?.question);
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId) || !isOpencodeRequestId(questionId)) {
      return context.reply(400, errorBody('Unknown sandbox, session or question.'));
    }
    const answer = readAnswer(body?.answer);
    if (!answer) return context.reply(400, errorBody('Answer at least one question field.'));

    try {
      await deps.opencode.run(sandboxId, async (connection) => {
        await connection.client.session.form.reply({ sessionID: sessionId, formID: questionId, answer });
      });
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
];
