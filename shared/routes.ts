/** What the panel and the service say to each other, plus the row action ids. */
import type {
  OpencodeCatalog,
  OpencodeInboxDelivery,
  OpencodeInboxEntry,
  OpencodeMessage,
  OpencodeModelRef,
  OpencodePermissionDecision,
  OpencodePermissionRequest,
  OpencodeQuestionAnswer,
  OpencodeQuestionRequest,
  OpencodeSession,
} from './opencode.ts';
import type { ProjectMatch, SandboxAction, SandboxActionVerb, SandboxSize, SandboxSummary } from './types.ts';

export type ErrorBody = { error: string };
export type OkBody = { ok: true };

export const errorBody = (error: string): ErrorBody => ({ error });

export type ScopedSandboxSummary = SandboxSummary & {
  matchedBy: ProjectMatch | null;
  inProject: boolean;
  /** True while one of the sandbox's OpenCode sessions has a turn running. */
  agentRunning: boolean;
};

export type SandboxesResponse = {
  sandboxes: ScopedSandboxSummary[];
  error: string | null;
  now: number;
  /** True when a project directory was usable and the list is scoped to it. */
  projectScoped: boolean;
};

export type CreateStartKind = 'clean' | 'snapshot' | 'copy';

export type CreateStart =
  | { kind: 'clean' }
  | { kind: 'snapshot'; name: string }
  | { kind: 'copy'; sandboxId: string };

export type CreateEnvironment = { name: string; isDefault: boolean };

export type CreateSnapshot = {
  name: string;
  type: string | null;
  createdAt: string | null;
  sizeBytes: number | null;
};

export type CreateSize = {
  id: SandboxSize;
  available: boolean;
  reason: string | null;
};

export type CreateLimits = {
  canStart: boolean;
  reason: string | null;
  active: number | null;
  maxActive: number | null;
  /** The plan's cap on an auto-stop lifetime, in hours. */
  autoStopMaxHours: number;
  sizes: CreateSize[];
};

export type CreateOptionsResponse = {
  environments: CreateEnvironment[];
  snapshots: CreateSnapshot[];
  limits: CreateLimits;
  suggestedEnvironment: string | null;
};

export type CreateSandboxRequest = {
  start: CreateStart;
  /** Undefined: the account default, or the source's environment for a copy. */
  environment?: string;
  /** Undefined: the default size, or the source's size for a copy. */
  size?: SandboxSize;
  name?: string;
  autoStopHours?: number;
};

export type CreateSandboxResponse = { accepted: true };

export type CreateProgress = {
  state: 'starting' | 'created' | 'ready' | 'failed';
  sandboxId?: string;
  message?: string;
};

export type ProjectsRequest = {
  /** The registered OpenChamber projects, as the panel sees them. */
  directories: string[];
};

export type ActionRequest = { sandbox: string; action: SandboxAction };
export type ActionResponse = OkBody & { url?: string };

/** Sessions in a sandbox, newest first. `directory` filters to one location. */
export type OpencodeSessionsResponse = {
  sessions: OpencodeSession[];
  /** Where a new session lands unless the panel picks another directory. */
  directory: string;
  /** The repository directories OpenCode can open sessions in, then the home. */
  directories: string[];
  now: number;
};

export type OpencodeMessagesResponse = {
  session: OpencodeSession;
  messages: OpencodeMessage[];
  permissions: OpencodePermissionRequest[];
  questions: OpencodeQuestionRequest[];
  /** Prompts OpenCode is still holding for this session. */
  inbox: OpencodeInboxEntry[];
  /** True when the history ran past the service's page cap. */
  truncated: boolean;
  now: number;
};

export type OpencodeCreateSessionRequest = {
  sandbox: string;
  /** An absolute directory from the catalog; defaults to the service's choice. */
  directory?: string;
  title?: string;
  agent?: string;
  model?: OpencodeModelRef;
};

export type OpencodeSessionResponse = { session: OpencodeSession };

/** An image the panel already downscaled; base64 without the data: prefix. */
export type OpencodePromptFile = {
  name: string;
  mime: string;
  data: string;
};

export type OpencodePromptRequest = {
  sandbox: string;
  session: string;
  text: string;
  /** Switch the session's agent and model before the prompt, when given. */
  agent?: string;
  model?: OpencodeModelRef;
  /** Steer the running turn, or queue the prompt for after it; idle sends all. */
  delivery?: OpencodeInboxDelivery;
  /** Inline attachments, sent as data URIs. */
  files?: OpencodePromptFile[];
};

export type OpencodePromptResponse = OkBody & {
  sessionID: string;
  /** The inbox entry the server admitted, when it returns one. */
  messageID: string | null;
};

export type OpencodeAbortRequest = { sandbox: string; session: string };
export type OpencodeAbortResponse = OkBody & { interrupted: boolean };

export type OpencodePermissionReplyRequest = {
  sandbox: string;
  session: string;
  request: string;
  decision: OpencodePermissionDecision;
  message?: string;
};

export type OpencodeQuestionReplyRequest = {
  sandbox: string;
  session: string;
  question: string;
  answer: Record<string, OpencodeQuestionAnswer>;
};

export type OpencodeCatalogResponse = OpencodeCatalog & { now: number };

/** The prompts a session is still holding, oldest first. */
export type OpencodeInboxResponse = {
  entries: OpencodeInboxEntry[];
  now: number;
};

export type OpencodeInboxCancelRequest = {
  sandbox: string;
  session: string;
  inbox: string;
};

export type OpencodeInboxUpdateRequest = OpencodeInboxCancelRequest & {
  delivery: OpencodeInboxDelivery;
};

/** One OpenCode event stream per sandbox; every watch call is a keep-alive. */
export type OpencodeWatchRequest = { sandbox: string };
export type OpencodeUnwatchRequest = OpencodeWatchRequest;

const ROW_ID_MAX = 40;

const rowId = (text: string): string => (
  text.length <= ROW_ID_MAX ? text : `${text.slice(0, ROW_ID_MAX - 1).trimEnd()}…`
);

/** A row action id carries its verb and sandbox: `stop-bx-7ppmwt9v`. */
export const statusActionId = (verb: SandboxActionVerb, sandboxId: string): string => (
  rowId(`${verb}-${sandboxId.replace(/_/g, '-').toLowerCase()}`)
);

export const parseStatusActionId = (id: string): { verb: SandboxActionVerb; sandboxId: string } | null => {
  const match = /^(stop|extend|resume)-([a-z0-9-]{1,32})$/.exec(id);
  if (!match?.[1] || !match[2]) return null;
  return { verb: match[1] as SandboxActionVerb, sandboxId: match[2].replace('-', '_') };
};
