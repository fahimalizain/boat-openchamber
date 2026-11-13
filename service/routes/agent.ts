import { isAgentProvider } from '../../shared/agent.ts';
import { readString } from '../../shared/json.ts';
import { errorBody, type PromptRequest, type PromptResponse } from '../../shared/routes.ts';
import type { ServiceContext } from '../context.ts';
import { providerForHarness } from '../data/agent-catalog.ts';
import { interruptSandbox, promptSandbox, steerSandbox, type PromptOptions } from '../domain/agent.ts';
import { describeFailure } from '../failures.ts';
import { route, type Route } from '../router.ts';
import {
  isConversationId,
  isSandboxId,
  MAX_MODEL_CHARS,
  MAX_PROMPT_CHARS,
} from '../validation.ts';

type Deps = Pick<ServiceContext, 'conversations' | 'catalog'>;

export const agentRoutes = (deps: Deps): Route[] => [
  route('POST', '/prompt', async (context) => {
    const body = await context.json<PromptRequest>();
    const sandboxId = readString(body?.sandbox);
    const text = readString(body?.text);
    const conversationId = readString(body?.conversation);
    const requestProvider = readString(body?.provider);
    let provider = requestProvider;
    let model = readString(body?.model);

    if (!isSandboxId(sandboxId)) return context.reply(400, errorBody('Unknown sandbox id.'));
    if (!text) return context.reply(400, errorBody('Write a prompt first.'));
    if (text.length > MAX_PROMPT_CHARS) return context.reply(400, errorBody('That prompt is too long.'));
    if (requestProvider && !isAgentProvider(requestProvider)) {
      return context.reply(400, errorBody('Unknown agent provider.'));
    }
    if (conversationId && !isConversationId(conversationId)) {
      return context.reply(400, errorBody('Unknown conversation id.'));
    }

    if (conversationId) {
      // Continue the conversation on its own harness and model, not boat's default.
      try {
        const conversations = await deps.conversations.get(sandboxId);
        const known = conversations.find((entry) => entry.id === conversationId) ?? null;
        if (known) {
          const catalog = await deps.catalog.get();
          provider = providerForHarness(catalog.agents, known.lastHarness) ?? provider;
          model = known.lastModel ?? model;
        }
      } catch {
        // Keep the panel's provider and model as the fallback.
      }
    }

    const options: PromptOptions = {
      provider: provider ?? undefined,
      model: model && model.length <= MAX_MODEL_CHARS ? model : undefined,
      reasoning: readString(body?.reasoning) ?? undefined,
      conversation: conversationId ?? undefined,
      newConversation: !conversationId,
    };

    try {
      const started = await promptSandbox(sandboxId, text, options);
      deps.conversations.forget(sandboxId);
      const answer: PromptResponse = { ok: true, ...started };
      return context.reply(200, answer);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('POST', '/steer', async (context) => {
    const body = await context.json<Record<string, unknown>>();
    const sandboxId = readString(body?.sandbox);
    const conversationId = readString(body?.conversation);
    const text = readString(body?.text);
    if (!isSandboxId(sandboxId) || !isConversationId(conversationId)) {
      return context.reply(400, errorBody('Unknown sandbox or conversation.'));
    }
    if (!text) return context.reply(400, errorBody('Write a message first.'));

    try {
      await steerSandbox(sandboxId, conversationId, text.slice(0, MAX_PROMPT_CHARS));
      deps.conversations.forget(sandboxId);
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('POST', '/interrupt', async (context) => {
    const body = await context.json<Record<string, unknown>>();
    const sandboxId = readString(body?.sandbox);
    const conversationId = readString(body?.conversation);
    if (!isSandboxId(sandboxId) || !isConversationId(conversationId)) {
      return context.reply(400, errorBody('Unknown sandbox or conversation.'));
    }

    try {
      await interruptSandbox(sandboxId, conversationId);
      deps.conversations.forget(sandboxId);
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
];
