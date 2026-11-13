/** The panel's state cell, its message helper, and the small resets around it. */
import type { AgentDto, ScopedSandboxSummary } from '../shared/routes.ts';
import type { Conversation, UiEvent } from '../shared/types.ts';
import { initialCreateState, type CreateState } from './create-state.ts';
import type { PanelTab } from './tab.ts';

/** The message a caught failure carries, or a plain fallback. */
export const messageOf = (failure: unknown): string => (
  failure instanceof Error && failure.message ? failure.message : 'Boat did not answer.'
);

export type BannerState = {
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body?: string;
};

export type PanelState = {
  sandboxes: ScopedSandboxSummary[];
  sandboxId: string | null;
  /** True when the service scoped the list to the open project. */
  projectScoped: boolean;
  conversations: Conversation[];
  conversationId: string | null;
  events: Map<string, UiEvent>;
  running: boolean;
  live: boolean;
  watchBroken: boolean;
  busy: boolean;
  loading: boolean;
  draft: string;
  provider: string;
  model: string;
  reasoning: string;
  agents: AgentDto[];
  banner: BannerState | null;
  /** The OpenChamber project, handed to the service for the project matcher. */
  directory: string | null;
  create: CreateState;
  /** On the phone: true shows the conversation list, false the chat. */
  compactList: boolean;
  /** A just-started conversation allowed to be missing from the list for a moment. */
  pendingConversationAt: number | null;
  tab: PanelTab;
};

export type Toast = (kind: 'info' | 'success' | 'error', message: string) => void;

export const initialState = (directory: string | null): PanelState => ({
  sandboxes: [],
  sandboxId: null,
  projectScoped: false,
  conversations: [],
  conversationId: null,
  events: new Map(),
  running: false,
  live: false,
  watchBroken: false,
  busy: false,
  loading: true,
  draft: '',
  provider: 'claude',
  model: '',
  reasoning: '',
  agents: [],
  banner: null,
  directory,
  create: initialCreateState(),
  compactList: true,
  pendingConversationAt: null,
  tab: 'sandboxes',
});

export type Cell = {
  get: () => PanelState;
  subscribe: (listener: () => void) => () => void;
  patch: (partial: Partial<PanelState>) => void;
  notify: () => void;
};

export const createCell = (state: PanelState): Cell => {
  const listeners = new Set<() => void>();

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    patch: (partial) => {
      Object.assign(state, partial);
      for (const listener of listeners) listener();
    },
    notify: () => {
      for (const listener of listeners) listener();
    },
  };
};

export const resetConversation = (cell: Cell): void => {
  cell.patch({
    conversationId: null,
    conversations: [],
    events: new Map(),
    running: false,
    live: false,
    watchBroken: false,
    pendingConversationAt: null,
  });
};

export type Reporter = {
  setBanner: (banner: BannerState | null) => void;
  fail: (title: string, failure: unknown) => void;
};

export const createReporter = (cell: Cell, toast: Toast): Reporter => ({
  setBanner: (banner) => cell.patch({ banner }),
  fail: (title, failure) => {
    const message = messageOf(failure);
    cell.patch({ banner: { tone: 'error', title, body: message } });
    toast('error', message);
  },
});
