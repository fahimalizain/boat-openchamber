/**
 * Normalised OpenCode shapes shared by the service and the panel. The service
 * maps the sandbox server's V2 payloads into these once; the panel never sees a
 * raw message, part or event.
 */

export type OpencodeModelRef = {
  id: string;
  providerID: string;
  variant: string | null;
};

export type OpencodeSessionStatus = 'busy' | 'idle' | 'error';

export type OpencodeSession = {
  id: string;
  /** OpenCode names a session from its first prompt; null until then. */
  title: string | null;
  /** The absolute location the session lives in, e.g. /home/user/app. */
  directory: string | null;
  projectID: string | null;
  agent: string | null;
  model: OpencodeModelRef | null;
  /** Epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
  busyAt: number | null;
  idleAt: number | null;
  archived: boolean;
  outcome: 'succeeded' | 'failed' | 'interrupted' | null;
  /** Derived from the execution timestamps and the last outcome. */
  status: OpencodeSessionStatus;
  /** Dollars, as OpenCode reports them. */
  cost: number;
};

/** A file a message or a tool refers to. Inline attachment bytes are dropped. */
export type OpencodeFilePart = {
  name: string | null;
  mime: string;
  uri: string | null;
};

export type OpencodeToolStatus = 'streaming' | 'running' | 'completed' | 'error';

export type OpencodeTool = {
  /** The provider's tool call id; unique inside one assistant message. */
  id: string;
  name: string;
  status: OpencodeToolStatus;
  /** Parsed input once the server has it; null while only inputText is known. */
  input: Record<string, unknown> | null;
  /** The raw JSON string while a tool's input is still streaming. */
  inputText: string | null;
  output: string | null;
  error: string | null;
  files: OpencodeFilePart[];
  metadata: Record<string, unknown> | null;
  /** False for tools the server did not execute (e.g. a skill lookup). */
  executed: boolean | null;
  startedAt: number | null;
  completedAt: number | null;
  /** True when output was clipped to keep a message (and an emit) small. */
  truncated: boolean;
};

export type OpencodeTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type OpencodeTodo = {
  content: string;
  status: OpencodeTodoStatus;
  priority: string | null;
};

export type OpencodeTextPart = {
  kind: 'text';
  /** Position in the assistant content array; -1 for user and notice text. */
  ordinal: number;
  text: string;
};

export type OpencodeReasoningPart = {
  kind: 'reasoning';
  ordinal: number;
  text: string;
  startedAt: number | null;
  completedAt: number | null;
};

export type OpencodeToolPart = {
  kind: 'tool';
  tool: OpencodeTool;
};

export type OpencodeFileContentPart = {
  kind: 'file';
  file: OpencodeFilePart;
};

export type OpencodePatchPart = {
  kind: 'patch';
  patch: OpencodePatch;
};

export type OpencodeTodoPart = {
  kind: 'todo';
  todos: OpencodeTodo[];
};

export type OpencodePart =
  | OpencodeTextPart
  | OpencodeReasoningPart
  | OpencodeToolPart
  | OpencodeFileContentPart
  | OpencodePatchPart
  | OpencodeTodoPart;

export type OpencodeTokens = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

/** One model step: an assistant message is one step in OpenCode V2. */
export type OpencodeStep = {
  agent: string | null;
  model: OpencodeModelRef | null;
  startedAt: number | null;
  completedAt: number | null;
  finish: string | null;
  cost: number;
  tokens: OpencodeTokens | null;
};

/** The files a step touched, from the assistant snapshot. */
export type OpencodePatch = {
  start: string | null;
  end: string | null;
  files: string[];
};

export type OpencodeMessageRole = 'user' | 'assistant' | 'system';

export type OpencodeMessage = {
  id: string;
  sessionID: string;
  /** The raw OpenCode message type: user, assistant, idle, shell, ... */
  type: string;
  role: OpencodeMessageRole;
  createdAt: number;
  completedAt: number | null;
  agent: string | null;
  model: OpencodeModelRef | null;
  parts: OpencodePart[];
  /** Assistant only. */
  step: OpencodeStep | null;
  /** Assistant only: the snapshot's changed files. */
  patch: OpencodePatch | null;
  /** User attachments, without their bytes. */
  files: OpencodeFilePart[];
  error: string | null;
  outcome: 'succeeded' | 'failed' | 'interrupted' | null;
  /** True while an assistant message has not completed. */
  streaming: boolean;
  /** One line for a system, skill, shell or compaction message. */
  notice: string | null;
  /** The last todowrite/todoread list in the message, flattened for rendering. */
  todos: OpencodeTodo[];
};

export type OpencodePermissionRequest = {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save: string[];
  message: string | null;
  /** The tool that asked, when OpenCode names one. */
  source: string | null;
  agent: string | null;
};

export type OpencodePermissionDecision = 'once' | 'always' | 'reject';

export type OpencodeQuestionOption = {
  value: string;
  label: string;
  description: string | null;
};

export type OpencodeQuestionFieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'multiselect'
  | 'external';

export type OpencodeQuestionField = {
  key: string;
  type: OpencodeQuestionFieldType;
  title: string;
  description: string | null;
  required: boolean;
  hidden: boolean;
  options: OpencodeQuestionOption[];
  minLength: number | null;
  maxLength: number | null;
  min: number | null;
  max: number | null;
  minItems: number | null;
  maxItems: number | null;
  default: string | number | boolean | string[] | null;
  /** External fields point at a URL the panel may open. */
  url: string | null;
};

/** A question is OpenCode's V2 "form": a titled set of fields to answer. */
export type OpencodeQuestionRequest = {
  id: string;
  sessionID: string;
  title: string;
  fields: OpencodeQuestionField[];
  metadata: Record<string, unknown> | null;
};

export type OpencodeQuestionAnswer = string | number | boolean | string[];

export type OpencodeAgent = {
  id: string;
  name: string;
  description: string | null;
  mode: string;
  hidden: boolean;
  model: OpencodeModelRef | null;
};

export type OpencodeProvider = {
  id: string;
  name: string;
};

export type OpencodeModel = {
  id: string;
  providerID: string;
  providerName: string;
  name: string;
  type: string | null;
  variants: string[];
  /** True when the model exposes at least one reasoning variant. */
  reasoning: boolean;
  tools: boolean;
  /** False when the catalogue says the model takes text only; null when unknown. */
  imageInput: boolean | null;
  contextLimit: number | null;
  outputLimit: number | null;
  enabled: boolean;
};

/** How a prompt reaches a running turn: into it now, or after it finishes. */
export type OpencodeInboxDelivery = 'steer' | 'queue';

/**
 * One prompt OpenCode is holding: a steer that has not reached the running turn
 * yet, or a queue waiting for the turn to end.
 */
export type OpencodeInboxEntry = {
  id: string;
  sessionID: string;
  /** The prompt's text, clipped for the one-line row the panel draws. */
  text: string;
  delivery: OpencodeInboxDelivery;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Attachments, without their bytes. */
  files: OpencodeFilePart[];
  type: 'user' | 'synthetic' | 'compaction' | 'move';
};

export type OpencodeCatalog = {
  directory: string;
  directories: string[];
  agents: OpencodeAgent[];
  providers: OpencodeProvider[];
  models: OpencodeModel[];
  defaultAgent: string | null;
  defaultModel: OpencodeModelRef | null;
};

/** Everything the panel needs while a sandbox's event stream is open. */
export type OpencodeStreamEvent =
  | {
    type: 'status';
    sessionID: string;
    status: OpencodeSessionStatus;
    error: string | null;
  }
  | {
    type: 'session-created';
    session: OpencodeSession;
  }
  | {
    type: 'session-updated';
    sessionID: string;
    title: string | null;
    directory: string | null;
  }
  | {
    type: 'session-deleted';
    sessionID: string;
  }
  | {
    /** The session's pending inbox gained, lost or re-flagged an entry. */
    type: 'inbox-changed';
    sessionID: string;
  }
  | {
    type: 'step';
    sessionID: string;
    messageID: string;
    phase: 'started' | 'ended';
    agent: string | null;
    model: OpencodeModelRef | null;
    finish: string | null;
    cost: number | null;
    tokens: OpencodeTokens | null;
    error: string | null;
  }
  | {
    type: 'part-start';
    sessionID: string;
    messageID: string;
    part: 'text' | 'reasoning';
    ordinal: number;
  }
  | {
    type: 'delta';
    sessionID: string;
    messageID: string;
    part: 'text' | 'reasoning';
    ordinal: number;
    delta: string;
  }
  | {
    type: 'part';
    sessionID: string;
    messageID: string;
    part: OpencodePart;
  }
  | {
    type: 'tool-start';
    sessionID: string;
    messageID: string;
    toolID: string;
    name: string;
  }
  | {
    type: 'tool-input-delta';
    sessionID: string;
    messageID: string;
    toolID: string;
    delta: string;
  }
  | {
    type: 'tool-input';
    sessionID: string;
    messageID: string;
    toolID: string;
    text: string;
  }
  | {
    type: 'tool-called';
    sessionID: string;
    messageID: string;
    toolID: string;
    input: Record<string, unknown> | null;
    executed: boolean | null;
  }
  | {
    type: 'tool-progress';
    sessionID: string;
    messageID: string;
    toolID: string;
    metadata: Record<string, unknown>;
  }
  | {
    type: 'tool-result';
    sessionID: string;
    messageID: string;
    toolID: string;
    status: 'completed' | 'error';
    output: string | null;
    files: OpencodeFilePart[];
    error: string | null;
    metadata: Record<string, unknown> | null;
    executed: boolean | null;
    truncated: boolean;
  }
  | {
    type: 'message-content';
    sessionID: string;
    messageID: string;
    parts: OpencodePart[];
  }
  | {
    type: 'message-changed';
    sessionID: string;
    messageID: string | null;
  }
  | {
    type: 'permission';
    request: OpencodePermissionRequest;
  }
  | {
    type: 'permission-replied';
    sessionID: string;
    requestID: string;
    reply: OpencodePermissionDecision;
  }
  | {
    type: 'question';
    request: OpencodeQuestionRequest;
  }
  | {
    type: 'question-replied';
    sessionID: string;
    questionID: string;
  };

/** Topic payload: one sandbox's normalised events, batched like boat's. */
export type OpencodeEventsPayload = {
  sandbox: string;
  events: OpencodeStreamEvent[];
};

/** Topic payload: the relay's own state, mirroring boat:stream. */
export type OpencodeStreamState = {
  sandbox: string;
  state: 'live' | 'ended' | 'error';
  message: string | null;
};

export const OPENCODE_EVENTS_TOPIC = 'boat:opencode';
export const OPENCODE_STREAM_TOPIC = 'boat:opencode-stream';
