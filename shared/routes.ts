/** What the panel and the service say to each other, plus the row action ids. */
import type { AgentProvider } from './agent.ts';
import type {
  Conversation,
  SandboxAction,
  SandboxActionVerb,
  SandboxSummary,
  UiEvent,
} from './types.ts';

export type ErrorBody = { error: string };
export type OkBody = { ok: true };

export const errorBody = (error: string): ErrorBody => ({ error });

export type SandboxesResponse = {
  sandboxes: SandboxSummary[];
  error: string | null;
  now: number;
};

export type ConversationsResponse = {
  conversations: Conversation[];
  now: number;
};

export type HistoryResponse = {
  events: UiEvent[];
  running: boolean | null;
  now: number;
};

export type WatchRequest = { sandbox: string; conversation: string };
export type UnwatchRequest = WatchRequest;

export type PromptRequest = {
  sandbox: string;
  text: string;
  /** Continue this conversation; omitted starts a new one. */
  conversation?: string;
  provider?: AgentProvider;
  model?: string;
};

export type PromptResponse = OkBody & PromptStart;

export type PromptStart = {
  /** The conversation the prompt went to, when the CLI printed it in time. */
  conversationId: string | null;
  /** True when the turn is still running and the CLI was left to finish it. */
  pending: boolean;
};

export type SteerRequest = { sandbox: string; conversation: string; text: string };
export type InterruptRequest = { sandbox: string; conversation: string };

export type ActionRequest = { sandbox: string; action: SandboxAction };
export type ActionResponse = OkBody & { url?: string };

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
