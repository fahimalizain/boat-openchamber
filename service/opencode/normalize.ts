/**
 * Pure mappings from OpenCode's V2 payloads to the shapes in shared/opencode.ts.
 * Every reader here is defensive: a newer sandbox may add fields, and a chat
 * should lose an unknown part rather than fail. Nothing in this module does I/O.
 */
import { clip, isRecord, readNumber, readString } from '../../shared/json.ts';
import type {
  OpencodeAgent,
  OpencodeFilePart,
  OpencodeInboxEntry,
  OpencodeMessage,
  OpencodeModel,
  OpencodeModelRef,
  OpencodePart,
  OpencodePermissionRequest,
  OpencodePermissionDecision,
  OpencodeProvider,
  OpencodeQuestionField,
  OpencodeQuestionFieldType,
  OpencodeQuestionOption,
  OpencodeQuestionRequest,
  OpencodeSession,
  OpencodeStreamEvent,
  OpencodeTodo,
  OpencodeTool,
  OpencodeTokens,
} from '../../shared/opencode.ts';

const TOOL_OUTPUT_MAX = 20_000;
const INBOX_TEXT_MAX = 400;

const readTimestamp = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const stringArray = (value: unknown): string[] => (
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
);

const recordOf = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null);

const readOutcome = (value: unknown): OpencodeMessage['outcome'] => (
  value === 'succeeded' || value === 'failed' || value === 'interrupted' ? value : null
);

const readError = (value: unknown): string | null => {
  if (typeof value === 'string') return readString(value);
  if (!isRecord(value)) return null;
  return readString(value.message) ?? readString(value.type) ?? null;
};

export const readModelRef = (value: unknown): OpencodeModelRef | null => {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const providerID = readString(value.providerID);
  if (!id || !providerID) return null;
  return { id, providerID, variant: readString(value.variant) };
};

/** The client's input shape omits `variant` rather than sending null. */
export const toModelRefInput = (model: OpencodeModelRef): { id: string; providerID: string; variant?: string } => ({
  id: model.id,
  providerID: model.providerID,
  ...(model.variant ? { variant: model.variant } : {}),
});

const readTokens = (value: unknown): OpencodeTokens | null => {
  if (!isRecord(value)) return null;
  const cache = isRecord(value.cache) ? value.cache : null;
  return {
    input: readNumber(value.input) ?? 0,
    output: readNumber(value.output) ?? 0,
    reasoning: readNumber(value.reasoning) ?? 0,
    cacheRead: readNumber(cache?.read) ?? 0,
    cacheWrite: readNumber(cache?.write) ?? 0,
  };
};

/** User attachments carry base64 bytes or a URI; only the reference is kept. */
const readAttachment = (value: unknown): OpencodeFilePart | null => {
  if (!isRecord(value)) return null;
  const source = isRecord(value.source) ? value.source : null;
  const uri = source?.type === 'uri' ? readString(source.uri) : null;
  return {
    name: readString(value.name),
    mime: readString(value.mime) ?? 'application/octet-stream',
    uri,
  };
};

const readToolContent = (value: unknown): { text: string | null; files: OpencodeFilePart[] } => {
  if (!Array.isArray(value)) return { text: null, files: [] };
  const texts: string[] = [];
  const files: OpencodeFilePart[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (entry.type === 'text') {
      const text = typeof entry.text === 'string' ? entry.text : '';
      if (text) texts.push(text);
    } else if (entry.type === 'file') {
      const uri = readString(entry.uri);
      if (!uri) continue;
      files.push({
        name: readString(entry.name),
        mime: readString(entry.mime) ?? 'application/octet-stream',
        uri,
      });
    }
  }
  return { text: texts.length > 0 ? texts.join('\n') : null, files };
};

const readTodos = (value: unknown): OpencodeTodo[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const content = readString(entry.content);
    if (!content) return [];
    const status = readString(entry.status);
    const normalised = status === 'in_progress' || status === 'completed' || status === 'cancelled'
      ? status
      : 'pending';
    return [{ content, status: normalised, priority: readString(entry.priority) }];
  });
};

/** The last todo list a tool touched, from `todowrite`/`todoread` input. */
const todosOfTools = (tools: OpencodeTool[]): OpencodeTodo[] => {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index];
    if (!tool?.input) continue;
    const todos = readTodos(tool.input.todos);
    if (todos.length > 0) return todos;
  }
  return [];
};

export const normalizeTool = (raw: unknown): OpencodeTool | null => {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const name = readString(raw.name);
  if (!id || !name) return null;

  const state = isRecord(raw.state) ? raw.state : {};
  const status = readString(state.status);
  const inputValue = state.input;
  const input = isRecord(inputValue) ? inputValue : null;
  const inputText = typeof inputValue === 'string' ? inputValue : null;
  const content = readToolContent(state.content);
  const output = content.text === null ? null : clip(content.text, TOOL_OUTPUT_MAX);
  const time = isRecord(raw.time) ? raw.time : {};

  return {
    id,
    name,
    status: status === 'streaming' || status === 'running' || status === 'completed' || status === 'error'
      ? status
      : 'running',
    input,
    inputText,
    output,
    error: readError(state.error),
    files: content.files,
    metadata: recordOf(state.metadata),
    executed: typeof raw.executed === 'boolean' ? raw.executed : null,
    startedAt: readTimestamp(time.created) || null,
    completedAt: readTimestamp(time.completed) || null,
    truncated: content.text !== null && content.text.length > TOOL_OUTPUT_MAX,
  };
};

/** Maps an assistant's content array; `ordinal` is its index, as V2 numbers it. */
export const normalizeAssistantContent = (value: unknown): { parts: OpencodePart[]; todos: OpencodeTodo[] } => {
  const parts: OpencodePart[] = [];
  const tools: OpencodeTool[] = [];
  if (!Array.isArray(value)) return { parts, todos: [] };

  value.forEach((entry, ordinal) => {
    if (!isRecord(entry)) return;
    if (entry.type === 'text') {
      const text = typeof entry.text === 'string' ? entry.text : '';
      if (text) parts.push({ kind: 'text', ordinal, text });
      return;
    }
    if (entry.type === 'reasoning') {
      const text = typeof entry.text === 'string' ? entry.text : '';
      if (!text) return;
      const time = isRecord(entry.time) ? entry.time : {};
      parts.push({
        kind: 'reasoning',
        ordinal,
        text,
        startedAt: readTimestamp(time.created) || null,
        completedAt: readTimestamp(time.completed) || null,
      });
      return;
    }
    if (entry.type === 'tool') {
      const tool = normalizeTool(entry);
      if (!tool) return;
      tools.push(tool);
      parts.push({ kind: 'tool', tool });
    }
  });

  const todos = todosOfTools(tools);
  if (todos.length > 0) parts.push({ kind: 'todo', todos });
  return { parts, todos };
};

const roleOf = (type: string): OpencodeMessage['role'] => {
  if (type === 'user') return 'user';
  if (type === 'assistant') return 'assistant';
  return 'system';
};

const textPart = (text: string): OpencodePart[] => (
  text ? [{ kind: 'text', ordinal: -1, text }] : []
);

/**
 * One projected message. The session id is passed in because OpenCode's message
 * payloads carry it only in events, not in the list response.
 */
export const normalizeMessage = (raw: unknown, sessionID: string): OpencodeMessage | null => {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  if (!id) return null;

  const type = readString(raw.type) ?? 'unknown';
  const time = isRecord(raw.time) ? raw.time : {};
  const createdAt = readTimestamp(time.created);
  const completedAt = readTimestamp(time.completed) || null;
  const role = roleOf(type);
  const model = role === 'assistant' ? readModelRef(raw.model) : null;
  const agent = readString(raw.agent);
  const outcome = readOutcome(raw.outcome);
  const error = readError(raw.error);

  const base: OpencodeMessage = {
    id,
    sessionID,
    type,
    role,
    createdAt,
    completedAt,
    agent,
    model,
    parts: [],
    step: null,
    patch: null,
    files: [],
    error,
    outcome,
    streaming: type === 'assistant' && completedAt === null,
    notice: null,
    todos: [],
  };

  if (type === 'assistant') {
    const { parts, todos } = normalizeAssistantContent(raw.content);
    const snapshot = isRecord(raw.snapshot) ? raw.snapshot : null;
    const files = snapshot ? stringArray(snapshot.files) : [];
    const patch = snapshot
      ? { start: readString(snapshot.start), end: readString(snapshot.end), files }
      : null;
    if (patch && files.length > 0) parts.push({ kind: 'patch', patch });
    return {
      ...base,
      parts,
      patch,
      todos,
      step: {
        agent,
        model,
        startedAt: createdAt || null,
        completedAt,
        finish: readString(raw.finish),
        cost: readNumber(raw.cost) ?? 0,
        tokens: readTokens(raw.tokens),
      },
    };
  }

  if (type === 'user') {
    const files = Array.isArray(raw.files)
      ? raw.files.flatMap((entry) => {
        const file = readAttachment(entry);
        return file ? [file] : [];
      })
      : [];
    const text = typeof raw.text === 'string' ? raw.text : '';
    return {
      ...base,
      parts: [...textPart(text), ...files.map((file): OpencodePart => ({ kind: 'file', file }))],
      files,
    };
  }

  if (type === 'idle') {
    return {
      ...base,
      error: error ?? (outcome === 'failed' ? 'The turn failed.' : null),
      notice: outcome === 'interrupted' ? 'Interrupted.' : null,
    };
  }

  if (type === 'shell') {
    const output = isRecord(raw.output) ? readString(raw.output.output) : null;
    const command = readString(raw.command);
    const text = output ?? command ?? '';
    return {
      ...base,
      parts: textPart(text),
      notice: command ? `$ ${command}` : null,
      streaming: raw.status === 'running',
    };
  }

  if (type === 'compaction') {
    const text = readString(raw.summary) ?? readString(raw.text) ?? '';
    const status = readString(raw.status);
    return {
      ...base,
      parts: textPart(text),
      notice: status === 'failed' ? 'Compaction failed.' : 'Compacted the conversation.',
      streaming: status === 'running',
    };
  }

  if (type === 'system' || type === 'synthetic' || type === 'skill') {
    const text = readString(raw.text) ?? '';
    return {
      ...base,
      parts: textPart(text),
      notice: readString(raw.description) ?? (type === 'skill' ? readString(raw.name) : null),
    };
  }

  if (type === 'agent-switched') {
    return { ...base, notice: `Agent switched to ${readString(raw.agent) ?? 'another agent'}.` };
  }

  if (type === 'model-switched') {
    const switched = readModelRef(raw.model);
    return {
      ...base,
      notice: switched ? `Model switched to ${switched.providerID}/${switched.id}.` : 'Model switched.',
    };
  }

  if (type === 'location-switched') {
    const location = isRecord(raw.location) ? readString(raw.location.directory) : null;
    return { ...base, notice: location ? `Moved to ${location}.` : 'Moved to another directory.' };
  }

  const text = readString(raw.text) ?? '';
  return { ...base, parts: textPart(text) };
};

const INBOX_TYPES: readonly OpencodeInboxEntry['type'][] = ['user', 'synthetic', 'compaction', 'move'];

/**
 * One prompt the server is holding. The payload may carry inline attachment
 * bytes; only the name and MIME survive, as everywhere else in this module.
 */
export const normalizeInboxEntry = (raw: unknown): OpencodeInboxEntry | null => {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const sessionID = readString(raw.sessionID);
  if (!id || !sessionID) return null;

  const payload = isRecord(raw.payload) ? raw.payload : {};
  const type = readString(raw.type);
  const delivery = raw.delivery === 'steer' ? 'steer' : 'queue';
  const files = Array.isArray(payload.files)
    ? payload.files.flatMap((entry) => {
      const file = readAttachment(entry);
      return file ? [file] : [];
    })
    : [];

  return {
    id,
    sessionID,
    text: clip(readString(payload.text) ?? '', INBOX_TEXT_MAX),
    delivery,
    createdAt: readTimestamp(isRecord(raw.time) ? raw.time.created : null),
    files,
    type: type !== null && (INBOX_TYPES as readonly string[]).includes(type)
      ? type as OpencodeInboxEntry['type']
      : 'user',
  };
};

/** `Session.Info`, or the smaller `session.created` event payload. */
export const normalizeSession = (raw: unknown): OpencodeSession | null => {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id) ?? readString(raw.sessionID);
  if (!id) return null;

  const time = isRecord(raw.time) ? raw.time : {};
  const location = isRecord(raw.location) ? raw.location : null;
  const outcome = readOutcome(raw.outcome);
  const busyAt = readTimestamp(time.busy) || null;
  const idleAt = readTimestamp(time.idle) || null;
  const busy = busyAt !== null && busyAt > (idleAt ?? 0);

  return {
    id,
    title: readString(raw.title),
    directory: readString(location?.directory),
    projectID: readString(raw.projectID),
    agent: readString(raw.agent),
    model: readModelRef(raw.model),
    createdAt: readTimestamp(time.created),
    updatedAt: readTimestamp(time.updated) || readTimestamp(time.created),
    busyAt,
    idleAt,
    archived: readTimestamp(time.archived) > 0,
    outcome,
    status: busy ? 'busy' : outcome === 'failed' ? 'error' : 'idle',
    cost: readNumber(raw.cost) ?? 0,
  };
};

export const normalizePermissionRequest = (raw: unknown): OpencodePermissionRequest | null => {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const sessionID = readString(raw.sessionID);
  if (!id || !sessionID) return null;
  const source = isRecord(raw.source) ? readString(raw.source.type) : null;
  return {
    id,
    sessionID,
    action: readString(raw.action) ?? 'unknown',
    resources: stringArray(raw.resources),
    save: stringArray(raw.save),
    message: readString(raw.message),
    source,
    agent: readString(raw.agent),
  };
};

const QUESTION_TYPES: readonly OpencodeQuestionFieldType[] = [
  'string', 'number', 'integer', 'boolean', 'multiselect', 'external',
];

const readQuestionOptions = (value: unknown): OpencodeQuestionOption[] => (
  Array.isArray(value)
    ? value.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const optionValue = readString(entry.value);
      if (!optionValue) return [];
      return [{
        value: optionValue,
        label: readString(entry.label) ?? optionValue,
        description: readString(entry.description),
      }];
    })
    : []
);

const readDefault = (value: unknown): OpencodeQuestionField['default'] => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return stringArray(value);
  return null;
};

const readQuestionField = (raw: unknown): OpencodeQuestionField | null => {
  if (!isRecord(raw)) return null;
  const key = readString(raw.key);
  const rawType = readString(raw.type);
  if (!key || !rawType || !(QUESTION_TYPES as readonly string[]).includes(rawType)) return null;
  return {
    key,
    type: rawType as OpencodeQuestionFieldType,
    title: readString(raw.title) ?? key,
    description: readString(raw.description),
    required: raw.required === true,
    hidden: raw.hidden === true,
    options: readQuestionOptions(raw.options),
    minLength: readNumber(raw.minLength),
    maxLength: readNumber(raw.maxLength),
    min: readNumber(raw.minimum),
    max: readNumber(raw.maximum),
    minItems: readNumber(raw.minItems),
    maxItems: readNumber(raw.maxItems),
    default: readDefault(raw.default),
    url: readString(raw.url),
  };
};

/** A V2 form is the question tool's UI; a form is what the panel answers. */
export const normalizeQuestionRequest = (raw: unknown): OpencodeQuestionRequest | null => {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const sessionID = readString(raw.sessionID);
  if (!id || !sessionID) return null;
  const fields = Array.isArray(raw.fields)
    ? raw.fields.flatMap((entry) => {
      const field = readQuestionField(entry);
      return field ? [field] : [];
    })
    : [];
  return {
    id,
    sessionID,
    title: readString(raw.title) ?? 'OpenCode needs an answer',
    fields,
    metadata: recordOf(raw.metadata),
  };
};

export const normalizeAgent = (raw: unknown): OpencodeAgent | null => {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  if (!id) return null;
  return {
    id,
    name: readString(raw.name) ?? id,
    description: readString(raw.description),
    mode: readString(raw.mode) ?? 'primary',
    hidden: raw.hidden === true,
    model: readModelRef(raw.model),
  };
};

export const normalizeProvider = (raw: unknown): OpencodeProvider | null => {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  if (!id) return null;
  return { id, name: readString(raw.name) ?? id };
};

export const normalizeModel = (raw: unknown, providerName: string): OpencodeModel | null => {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id) ?? readString(raw.modelID);
  const providerID = readString(raw.providerID);
  if (!id || !providerID) return null;
  const variants = Array.isArray(raw.variants)
    ? raw.variants.flatMap((entry) => {
      const variant = isRecord(entry) ? readString(entry.id) : null;
      return variant ? [variant] : [];
    })
    : [];
  const capabilities = isRecord(raw.capabilities) ? raw.capabilities : null;
  const inputs = Array.isArray(capabilities?.input)
    ? capabilities.input.filter((entry): entry is string => typeof entry === 'string')
    : null;
  const limit = isRecord(raw.limit) ? raw.limit : null;
  return {
    id,
    providerID,
    providerName,
    name: readString(raw.name) ?? id,
    type: readString(raw.type),
    variants,
    reasoning: variants.length > 0,
    tools: capabilities?.tools === true,
    imageInput: inputs === null ? null : inputs.includes('image'),
    contextLimit: readNumber(limit?.context),
    outputLimit: readNumber(limit?.output),
    enabled: raw.enabled !== false,
  };
};

/** The model list is `Model.Info[]`; `providerNames` maps a provider id to its label. */
export const normalizeModels = (value: unknown, providerNames: Map<string, string>): OpencodeModel[] => (
  Array.isArray(value)
    ? value.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const providerID = readString(entry.providerID);
      const model = normalizeModel(entry, providerID ? providerNames.get(providerID) ?? providerID : '');
      return model ? [model] : [];
    })
    : []
);

const eventData = (raw: Record<string, unknown>): Record<string, unknown> => (
  isRecord(raw.data) ? raw.data : {}
);

const sessionIDOf = (data: Record<string, unknown>): string | null => readString(data.sessionID);

const messageIDOf = (data: Record<string, unknown>): string | null => (
  readString(data.assistantMessageID) ?? readString(data.messageID)
);

const toolResultOf = (
  data: Record<string, unknown>,
  status: 'completed' | 'error',
): OpencodeStreamEvent | null => {
  const sessionID = sessionIDOf(data);
  const messageID = messageIDOf(data);
  const toolID = readString(data.id);
  if (!sessionID || !messageID || !toolID) return null;
  const content = readToolContent(data.content);
  const output = content.text === null ? null : clip(content.text, TOOL_OUTPUT_MAX);
  return {
    type: 'tool-result',
    sessionID,
    messageID,
    toolID,
    status,
    output,
    files: content.files,
    error: readError(data.error),
    metadata: recordOf(data.metadata),
    executed: typeof data.executed === 'boolean' ? data.executed : null,
    truncated: content.text !== null && content.text.length > TOOL_OUTPUT_MAX,
  };
};

/**
 * One SSE event from `/api/event`, or null for the many events the chat does
 * not need (usage counters, config reloads, the server's hello).
 */
export const normalizeStreamEvent = (raw: unknown): OpencodeStreamEvent | null => {
  if (!isRecord(raw)) return null;
  const type = readString(raw.type);
  if (!type) return null;
  const data = eventData(raw);
  const sessionID = sessionIDOf(data);
  const messageID = messageIDOf(data);

  switch (type) {
    case 'session.created': {
      const session = normalizeSession({
        ...data,
        id: data.sessionID,
        time: { created: readTimestamp(raw.created), updated: readTimestamp(raw.created) },
      });
      return session ? { type: 'session-created', session } : null;
    }
    case 'session.renamed':
      if (!sessionID) return null;
      return { type: 'session-updated', sessionID, title: readString(data.title), directory: null };
    case 'session.moved': {
      if (!sessionID) return null;
      const location = isRecord(data.location) ? readString(data.location.directory) : null;
      return { type: 'session-updated', sessionID, title: null, directory: location };
    }
    case 'session.deleted':
      return sessionID ? { type: 'session-deleted', sessionID } : null;
    case 'session.archived':
    case 'session.unarchived':
    case 'session.model.selected':
    case 'session.agent.selected':
    case 'session.permissions':
    case 'session.metadata.updated':
      return sessionID ? { type: 'session-updated', sessionID, title: null, directory: null } : null;

    case 'session.status': {
      if (!sessionID) return null;
      const status = isRecord(data.status) ? data.status : null;
      const kind = readString(status?.type);
      if (kind === 'busy') return { type: 'status', sessionID, status: 'busy', error: null };
      if (kind === 'idle') return { type: 'status', sessionID, status: 'idle', error: null };
      if (kind === 'retry') {
        return { type: 'status', sessionID, status: 'busy', error: readString(status?.message) };
      }
      return null;
    }
    case 'session.execution.started':
      return sessionID ? { type: 'status', sessionID, status: 'busy', error: null } : null;
    case 'session.execution.succeeded':
    case 'session.execution.interrupted':
      return sessionID ? { type: 'status', sessionID, status: 'idle', error: null } : null;
    case 'session.execution.failed':
      return sessionID
        ? { type: 'status', sessionID, status: 'error', error: readError(data.error) }
        : null;
    case 'session.idle':
      return sessionID ? { type: 'status', sessionID, status: 'idle', error: null } : null;
    case 'session.retry.scheduled':
      return sessionID
        ? { type: 'status', sessionID, status: 'busy', error: readString(data.message) }
        : null;

    case 'session.step.started':
      if (!sessionID || !messageID) return null;
      return {
        type: 'step',
        sessionID,
        messageID,
        phase: 'started',
        agent: readString(data.agent),
        model: readModelRef(data.model),
        finish: null,
        cost: null,
        tokens: null,
        error: null,
      };
    case 'session.step.ended':
    case 'session.step.failed':
      if (!sessionID || !messageID) return null;
      return {
        type: 'step',
        sessionID,
        messageID,
        phase: 'ended',
        agent: null,
        model: null,
        finish: readString(data.finish),
        cost: readNumber(data.cost),
        tokens: readTokens(data.tokens),
        error: readError(data.error),
      };

    case 'session.text.started':
    case 'session.reasoning.started': {
      if (!sessionID || !messageID) return null;
      const ordinal = readNumber(data.ordinal) ?? 0;
      return {
        type: 'part-start',
        sessionID,
        messageID,
        part: type === 'session.text.started' ? 'text' : 'reasoning',
        ordinal,
      };
    }
    case 'session.text.delta':
    case 'session.reasoning.delta': {
      if (!sessionID || !messageID) return null;
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (!delta) return null;
      return {
        type: 'delta',
        sessionID,
        messageID,
        part: type === 'session.text.delta' ? 'text' : 'reasoning',
        ordinal: readNumber(data.ordinal) ?? 0,
        delta,
      };
    }
    case 'session.text.ended':
    case 'session.reasoning.ended': {
      if (!sessionID || !messageID) return null;
      const ordinal = readNumber(data.ordinal) ?? 0;
      if (type === 'session.text.ended') {
        return {
          type: 'part',
          sessionID,
          messageID,
          part: { kind: 'text', ordinal, text: typeof data.text === 'string' ? data.text : '' },
        };
      }
      return {
        type: 'part',
        sessionID,
        messageID,
        part: { kind: 'reasoning', ordinal, text: typeof data.text === 'string' ? data.text : '', startedAt: null, completedAt: null },
      };
    }

    case 'session.tool.input.started': {
      if (!sessionID || !messageID) return null;
      const toolID = readString(data.id);
      const name = readString(data.name);
      if (!toolID || !name) return null;
      return { type: 'tool-start', sessionID, messageID, toolID, name };
    }
    case 'session.tool.input.delta': {
      if (!sessionID || !messageID) return null;
      const toolID = readString(data.id);
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (!toolID || !delta) return null;
      return { type: 'tool-input-delta', sessionID, messageID, toolID, delta };
    }
    case 'session.tool.input.ended': {
      if (!sessionID || !messageID) return null;
      const toolID = readString(data.id);
      if (!toolID) return null;
      return {
        type: 'tool-input',
        sessionID,
        messageID,
        toolID,
        text: typeof data.text === 'string' ? data.text : '',
      };
    }
    case 'session.tool.called': {
      if (!sessionID || !messageID) return null;
      const toolID = readString(data.id);
      if (!toolID) return null;
      return {
        type: 'tool-called',
        sessionID,
        messageID,
        toolID,
        input: recordOf(data.input),
        executed: typeof data.executed === 'boolean' ? data.executed : null,
      };
    }
    case 'session.tool.progress': {
      if (!sessionID || !messageID) return null;
      const toolID = readString(data.id);
      const metadata = recordOf(data.metadata);
      if (!toolID || !metadata) return null;
      return { type: 'tool-progress', sessionID, messageID, toolID, metadata };
    }
    case 'session.tool.success':
    case 'session.tool.failed':
      return toolResultOf(data, type === 'session.tool.success' ? 'completed' : 'error');

    case 'session.message.content.updated': {
      if (!sessionID || !messageID) return null;
      const { parts } = normalizeAssistantContent(data.content);
      return { type: 'message-content', sessionID, messageID, parts };
    }
    case 'session.inbox.enqueued':
    case 'session.inbox.cancelled':
    case 'session.inbox.delivery.changed': {
      if (!sessionID) return null;
      return { type: 'inbox-changed', sessionID };
    }
    case 'session.inbox.delivered': {
      if (!sessionID) return null;
      // Delivery moves the entry into the history the panel already refetches.
      return { type: 'message-changed', sessionID, messageID: readString(data.inboxID) };
    }
    case 'session.synthetic':
    case 'session.skill.activated':
    case 'session.shell.started':
    case 'session.shell.ended':
    case 'session.compaction.started':
    case 'session.compaction.delta':
    case 'session.compaction.ended':
    case 'session.compaction.failed':
    case 'session.instructions.updated':
      return sessionID ? { type: 'message-changed', sessionID, messageID: null } : null;

    case 'permission.asked': {
      const request = normalizePermissionRequest(data);
      return request ? { type: 'permission', request } : null;
    }
    case 'permission.replied': {
      if (!sessionID) return null;
      const requestID = readString(data.requestID);
      const reply = readString(data.reply);
      if (!requestID || (reply !== 'once' && reply !== 'always' && reply !== 'reject')) return null;
      return {
        type: 'permission-replied',
        sessionID,
        requestID,
        reply: reply as OpencodePermissionDecision,
      };
    }
    case 'form.created': {
      const form = isRecord(data.form) ? normalizeQuestionRequest(data.form) : null;
      return form ? { type: 'question', request: form } : null;
    }
    case 'form.replied':
    case 'form.cancelled': {
      if (!sessionID) return null;
      const questionID = readString(data.id);
      return questionID ? { type: 'question-replied', sessionID, questionID } : null;
    }

    default:
      return null;
  }
};
