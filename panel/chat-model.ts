/**
 * The chat model: one session's projected messages and the permission and
 * question requests waiting on it, plus the pure reducer that applies a batch
 * of OpenCode stream events. The view re-reads this after every batch; nothing
 * here touches the DOM and nothing here does I/O.
 */
import type {
  OpencodeMessage,
  OpencodeModelRef,
  OpencodePart,
  OpencodePermissionRequest,
  OpencodeQuestionRequest,
  OpencodeSession,
  OpencodeSessionStatus,
  OpencodeStreamEvent,
  OpencodeTodo,
  OpencodeTokens,
  OpencodeTool,
  OpencodeToolPart,
} from '../shared/opencode.ts';

export type ChatModel = {
  session: OpencodeSession;
  messages: OpencodeMessage[];
  permissions: OpencodePermissionRequest[];
  questions: OpencodeQuestionRequest[];
  /** True when the service stopped at its history page cap. */
  truncated: boolean;
};

export const createChatModel = (input: {
  session: OpencodeSession;
  messages: OpencodeMessage[];
  permissions?: OpencodePermissionRequest[];
  questions?: OpencodeQuestionRequest[];
  truncated?: boolean;
}): ChatModel => ({
  session: input.session,
  messages: [...input.messages],
  permissions: [...(input.permissions ?? [])],
  questions: [...(input.questions ?? [])],
  truncated: input.truncated === true,
});

const emptyStep = (tokens: OpencodeTokens | null = null): NonNullable<OpencodeMessage['step']> => ({
  agent: null,
  model: null,
  startedAt: null,
  completedAt: null,
  finish: null,
  cost: 0,
  tokens,
});

const emptyAssistant = (sessionID: string, id: string): OpencodeMessage => ({
  id,
  sessionID,
  type: 'assistant',
  role: 'assistant',
  createdAt: Date.now(),
  completedAt: null,
  agent: null,
  model: null,
  parts: [],
  step: emptyStep(),
  patch: null,
  files: [],
  error: null,
  outcome: null,
  streaming: true,
  notice: null,
  todos: [],
});

const indexOf = (model: ChatModel, id: string): number => model.messages.findIndex((entry) => entry.id === id);

const replaceMessage = (model: ChatModel, index: number, message: OpencodeMessage): ChatModel => {
  const messages = [...model.messages];
  messages[index] = message;
  return { ...model, messages };
};

/** The assistant message an event belongs to, created when history has not caught up. */
const ensureAssistant = (model: ChatModel, sessionID: string, messageID: string): { model: ChatModel; index: number } => {
  const index = indexOf(model, messageID);
  if (index >= 0) return { model, index };
  return {
    model: { ...model, messages: [...model.messages, emptyAssistant(sessionID, messageID)] },
    index: model.messages.length,
  };
};

const partKey = (part: OpencodePart): string => {
  switch (part.kind) {
    case 'text':
    case 'reasoning':
      return `${part.kind}:${part.ordinal}`;
    case 'tool':
      return `tool:${part.tool.id}`;
    case 'file':
      return `file:${part.file.uri ?? part.file.name ?? part.file.mime}`;
    case 'patch':
      return 'patch';
    case 'todo':
      return 'todo';
  }
};

const upsertPart = (parts: OpencodePart[], part: OpencodePart): OpencodePart[] => {
  const key = partKey(part);
  const index = parts.findIndex((entry) => partKey(entry) === key);
  if (index < 0) return [...parts, part];
  const next = [...parts];
  next[index] = part;
  return next;
};

const todosIn = (parts: OpencodePart[]): OpencodeTodo[] => {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.kind === 'todo') return part.todos;
  }
  return [];
};

const withParts = (message: OpencodeMessage, parts: OpencodePart[]): OpencodeMessage => ({
  ...message,
  parts,
  todos: todosIn(parts),
});

/** Appends a streamed text or reasoning delta, creating the part on first sight. */
const appendText = (
  parts: OpencodePart[],
  kind: 'text' | 'reasoning',
  ordinal: number,
  delta: string,
): OpencodePart[] => {
  const index = parts.findIndex((entry) => (
    (entry.kind === 'text' || entry.kind === 'reasoning') && entry.kind === kind && entry.ordinal === ordinal
  ));
  if (index < 0) {
    return [
      ...parts,
      kind === 'text'
        ? { kind: 'text', ordinal, text: delta }
        : { kind: 'reasoning', ordinal, text: delta, startedAt: Date.now(), completedAt: null },
    ];
  }
  const existing = parts[index];
  if (existing?.kind !== kind) return parts;
  const next = [...parts];
  next[index] = { ...existing, text: existing.text + delta } as OpencodePart;
  return next;
};

type ToolUpdate = {
  parts: OpencodePart[];
  found: boolean;
};

/** Tool events are keyed by the provider's call id, not by part ordinal. */
const updateTool = (parts: OpencodePart[], toolID: string, update: (tool: OpencodeTool) => OpencodeTool): ToolUpdate => {
  const index = parts.findIndex((entry) => entry.kind === 'tool' && entry.tool.id === toolID);
  if (index < 0) return { parts, found: false };
  const existing = parts[index];
  if (existing?.kind !== 'tool') return { parts, found: false };
  const next = [...parts];
  next[index] = { kind: 'tool', tool: update(existing.tool) } satisfies OpencodeToolPart;
  return { parts: next, found: true };
};

const placeholderTool = (id: string, name: string): OpencodeTool => ({
  id,
  name,
  status: 'streaming',
  input: null,
  inputText: null,
  output: null,
  error: null,
  files: [],
  metadata: null,
  executed: null,
  startedAt: Date.now(),
  completedAt: null,
  truncated: false,
});

const parseInput = (text: string | null): Record<string, unknown> | null => {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const sameList = <T>(left: T[], right: T[]): boolean => (
  left.length === right.length && left.every((entry, index) => entry === right[index])
);

/** Applies one stream event; an event for another session leaves the model alone. */
export const applyChatEvent = (model: ChatModel, event: OpencodeStreamEvent): ChatModel => {
  if (event.type === 'session-created') {
    return event.session.id === model.session.id ? { ...model, session: event.session } : model;
  }
  if (event.type === 'permission') {
    if (event.request.sessionID !== model.session.id) return model;
    if (model.permissions.some((entry) => entry.id === event.request.id)) return model;
    return { ...model, permissions: [...model.permissions, event.request] };
  }
  if (event.type === 'question') {
    if (event.request.sessionID !== model.session.id) return model;
    if (model.questions.some((entry) => entry.id === event.request.id)) return model;
    return { ...model, questions: [...model.questions, event.request] };
  }
  if (event.type === 'permission-replied') {
    if (event.sessionID !== model.session.id) return model;
    const permissions = model.permissions.filter((entry) => entry.id !== event.requestID);
    return sameList(permissions, model.permissions) ? model : { ...model, permissions };
  }
  if (event.type === 'question-replied') {
    if (event.sessionID !== model.session.id) return model;
    const questions = model.questions.filter((entry) => entry.id !== event.questionID);
    return sameList(questions, model.questions) ? model : { ...model, questions };
  }
  if (event.type === 'session-updated') {
    if (event.sessionID !== model.session.id) return model;
    if (event.title === null && event.directory === null) return model;
    return {
      ...model,
      session: {
        ...model.session,
        ...(event.title !== null ? { title: event.title } : {}),
        ...(event.directory !== null ? { directory: event.directory } : {}),
      },
    };
  }
  if (event.type === 'session-deleted') return model;
  if (event.type === 'message-changed') return model;
  if (event.sessionID !== model.session.id) return model;

  switch (event.type) {
    case 'status': {
      const now = Date.now();
      const idle = event.status !== 'busy';
      let changed = false;
      const messages = idle
        ? model.messages.map((message) => {
          if (message.role !== 'assistant' || !message.streaming) return message;
          changed = true;
          return { ...message, streaming: false, completedAt: message.completedAt ?? now };
        })
        : model.messages;
      return {
        ...model,
        session: {
          ...model.session,
          status: event.status,
          busyAt: event.status === 'busy' ? now : model.session.busyAt,
          idleAt: idle ? now : model.session.idleAt,
          outcome: event.status === 'error' ? 'failed' : model.session.outcome,
        },
        messages: changed ? messages : model.messages,
      };
    }

    case 'step': {
      const { model: withMessage, index } = ensureAssistant(model, event.sessionID, event.messageID);
      const message = withMessage.messages[index];
      if (!message) return withMessage;
      const base = message.step ?? emptyStep();
      const failed = event.phase === 'ended' && event.error !== null;
      const step = event.phase === 'started'
        ? {
          ...base,
          agent: event.agent ?? base.agent,
          model: event.model ?? base.model,
          startedAt: base.startedAt ?? Date.now(),
        }
        : {
          ...base,
          completedAt: Date.now(),
          finish: event.finish ?? base.finish,
          cost: event.cost ?? base.cost,
          tokens: event.tokens ?? base.tokens,
        };
      return replaceMessage(withMessage, index, {
        ...message,
        agent: event.agent ?? message.agent,
        model: event.model ?? message.model,
        step,
        streaming: event.phase === 'started',
        completedAt: event.phase === 'ended' ? (message.completedAt ?? Date.now()) : message.completedAt,
        ...(failed ? { error: event.error, outcome: 'failed' as const } : {}),
      });
    }

    case 'part-start': {
      const { model: withMessage, index } = ensureAssistant(model, event.sessionID, event.messageID);
      const message = withMessage.messages[index];
      if (!message) return withMessage;
      const exists = message.parts.some((entry) => partKey(entry) === `${event.part}:${event.ordinal}`);
      const parts = exists
        ? message.parts
        : upsertPart(message.parts, event.part === 'text'
          ? { kind: 'text', ordinal: event.ordinal, text: '' }
          : { kind: 'reasoning', ordinal: event.ordinal, text: '', startedAt: Date.now(), completedAt: null });
      return replaceMessage(withMessage, index, { ...withParts(message, parts), streaming: true });
    }

    case 'delta': {
      const { model: withMessage, index } = ensureAssistant(model, event.sessionID, event.messageID);
      const message = withMessage.messages[index];
      if (!message) return withMessage;
      return replaceMessage(withMessage, index, {
        ...withParts(message, appendText(message.parts, event.part, event.ordinal, event.delta)),
        streaming: true,
      });
    }

    case 'part': {
      const { model: withMessage, index } = ensureAssistant(model, event.sessionID, event.messageID);
      const message = withMessage.messages[index];
      if (!message) return withMessage;
      return replaceMessage(withMessage, index, withParts(message, upsertPart(message.parts, event.part)));
    }

    case 'tool-start': {
      const { model: withMessage, index } = ensureAssistant(model, event.sessionID, event.messageID);
      const message = withMessage.messages[index];
      if (!message) return withMessage;
      const exists = message.parts.some((entry) => entry.kind === 'tool' && entry.tool.id === event.toolID);
      const parts = exists ? message.parts : [...message.parts, { kind: 'tool', tool: placeholderTool(event.toolID, event.name) } satisfies OpencodeToolPart];
      return replaceMessage(withMessage, index, withParts(message, parts));
    }

    case 'tool-input-delta': {
      const { model: withMessage, index } = ensureAssistant(model, event.sessionID, event.messageID);
      const message = withMessage.messages[index];
      if (!message) return withMessage;
      const result = updateTool(message.parts, event.toolID, (tool) => ({
        ...tool,
        inputText: (tool.inputText ?? '') + event.delta,
      }));
      const parts = result.found ? result.parts : [...message.parts, { kind: 'tool', tool: { ...placeholderTool(event.toolID, 'tool'), inputText: event.delta } } satisfies OpencodeToolPart];
      return replaceMessage(withMessage, index, withParts(message, parts));
    }

    case 'tool-input': {
      const { model: withMessage, index } = ensureAssistant(model, event.sessionID, event.messageID);
      const message = withMessage.messages[index];
      if (!message) return withMessage;
      const result = updateTool(message.parts, event.toolID, (tool) => ({
        ...tool,
        inputText: event.text,
        input: parseInput(event.text) ?? tool.input,
      }));
      if (!result.found) return withMessage;
      return replaceMessage(withMessage, index, withParts(message, result.parts));
    }

    case 'tool-called': {
      const { model: withMessage, index } = ensureAssistant(model, event.sessionID, event.messageID);
      const message = withMessage.messages[index];
      if (!message) return withMessage;
      const result = updateTool(message.parts, event.toolID, (tool) => ({
        ...tool,
        status: 'running',
        input: event.input ?? parseInput(tool.inputText) ?? tool.input,
        executed: event.executed ?? tool.executed,
      }));
      if (!result.found) return withMessage;
      return replaceMessage(withMessage, index, withParts(message, result.parts));
    }

    case 'tool-progress': {
      const { model: withMessage, index } = ensureAssistant(model, event.sessionID, event.messageID);
      const message = withMessage.messages[index];
      if (!message) return withMessage;
      const result = updateTool(message.parts, event.toolID, (tool) => ({
        ...tool,
        status: 'running',
        metadata: { ...(tool.metadata ?? {}), ...event.metadata },
      }));
      if (!result.found) return withMessage;
      return replaceMessage(withMessage, index, withParts(message, result.parts));
    }

    case 'tool-result': {
      const { model: withMessage, index } = ensureAssistant(model, event.sessionID, event.messageID);
      const message = withMessage.messages[index];
      if (!message) return withMessage;
      const result = updateTool(message.parts, event.toolID, (tool) => ({
        ...tool,
        status: event.status,
        output: event.output,
        files: event.files.length > 0 ? event.files : tool.files,
        error: event.error,
        metadata: event.metadata ? { ...(tool.metadata ?? {}), ...event.metadata } : tool.metadata,
        executed: event.executed ?? tool.executed,
        truncated: event.truncated,
        completedAt: Date.now(),
      }));
      if (!result.found) return withMessage;
      return replaceMessage(withMessage, index, withParts(message, result.parts));
    }

    case 'message-content': {
      const index = indexOf(model, event.messageID);
      if (index >= 0) {
        const message = model.messages[index];
        if (!message || message.role !== 'assistant') return model;
        return replaceMessage(model, index, { ...withParts(message, event.parts), streaming: true });
      }
      const { model: withMessage, index: added } = ensureAssistant(model, event.sessionID, event.messageID);
      const message = withMessage.messages[added];
      if (!message) return withMessage;
      return replaceMessage(withMessage, added, { ...withParts(message, event.parts), streaming: true });
    }

    default:
      return model;
  }
};

export const applyChatEvents = (model: ChatModel, events: OpencodeStreamEvent[]): ChatModel => (
  events.reduce(applyChatEvent, model)
);

/** The status a prompt or an abort forces without waiting for the stream. */
export const withSessionStatus = (
  session: OpencodeSession,
  status: OpencodeSessionStatus,
): OpencodeSession => {
  const now = Date.now();
  return {
    ...session,
    status,
    busyAt: status === 'busy' ? now : session.busyAt,
    idleAt: status !== 'busy' ? now : session.idleAt,
    outcome: status === 'error' ? 'failed' : session.outcome,
  };
};

/** Session-list side of the same events: titles, arrivals, departures and status. */
export const applySessionEvent = (sessions: OpencodeSession[], event: OpencodeStreamEvent): OpencodeSession[] => {
  if (event.type === 'session-created') {
    const existing = sessions.findIndex((session) => session.id === event.session.id);
    if (existing < 0) return [event.session, ...sessions];
    const next = [...sessions];
    next[existing] = event.session;
    return next;
  }
  if (event.type === 'session-deleted') {
    const next = sessions.filter((session) => session.id !== event.sessionID);
    return next.length === sessions.length ? sessions : next;
  }
  if (event.type === 'session-updated') {
    if (event.title === null && event.directory === null) return sessions;
    return sessions.map((session) => (
      session.id !== event.sessionID
        ? session
        : {
          ...session,
          ...(event.title !== null ? { title: event.title } : {}),
          ...(event.directory !== null ? { directory: event.directory } : {}),
        }
    ));
  }
  if (event.type === 'status') {
    return sessions.map((session) => (
      session.id === event.sessionID ? withSessionStatus(session, event.status) : session
    ));
  }
  return sessions;
};

export const applySessionEvents = (sessions: OpencodeSession[], events: OpencodeStreamEvent[]): OpencodeSession[] => (
  events.reduce(applySessionEvent, sessions)
);

export const withoutPermission = (model: ChatModel, requestID: string): ChatModel => {
  const permissions = model.permissions.filter((entry) => entry.id !== requestID);
  return sameList(permissions, model.permissions) ? model : { ...model, permissions };
};

export const withoutQuestion = (model: ChatModel, questionID: string): ChatModel => {
  const questions = model.questions.filter((entry) => entry.id !== questionID);
  return sameList(questions, model.questions) ? model : { ...model, questions };
};

/** The agent and model a message was produced with, for the chat header. */
export const messageSpeaker = (message: OpencodeMessage): string => {
  const parts = [message.agent, message.model ? modelLabelOf(message.model) : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'OpenCode';
};

const modelLabelOf = (model: OpencodeModelRef): string => (
  model.variant && model.variant !== 'default' ? `${model.id} · ${model.variant}` : model.id
);
