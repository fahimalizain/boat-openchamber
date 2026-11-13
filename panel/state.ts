/** The panel's state cell, its message helper, and the small resets around it. */
import type { AgentProvider } from '../shared/agent.ts';
import type { Conversation, SandboxSummary, UiEvent } from '../shared/types.ts';
import { messageOf } from './format.ts';

export type BannerState = {
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body?: string;
};

export type PanelState = {
  sandboxes: SandboxSummary[];
  sandboxId: string | null;
  conversations: Conversation[];
  conversationId: string | null;
  events: Map<string, UiEvent>;
  running: boolean;
  live: boolean;
  watchBroken: boolean;
  busy: boolean;
  loading: boolean;
  draft: string;
  provider: AgentProvider;
  model: string;
  banner: BannerState | null;
  /** The OpenChamber project, handed to the service for the project matcher. */
  directory: string | null;
};

export type Toast = (kind: 'info' | 'success' | 'error', message: string) => void;

export const initialState = (directory: string | null): PanelState => ({
  sandboxes: [],
  sandboxId: null,
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
  banner: null,
  directory,
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
