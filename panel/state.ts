/** The panel's state cell, its message helper, and the small resets around it. */
import type {
  OpencodeCatalog,
  OpencodeModelRef,
  OpencodeSession,
} from '../shared/opencode.ts';
import type { ScopedSandboxSummary } from '../shared/routes.ts';
import type { ChatModel } from './chat-model.ts';
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
  loading: boolean;
  /** A panel action is in flight; blocks a second one. */
  busy: boolean;
  banner: BannerState | null;
  /** The OpenChamber project, handed to the service for the project matcher. */
  directory: string | null;
  create: CreateState;
  /** On the phone: true shows the session list, false the chat. */
  compactList: boolean;
  tab: PanelTab;

  /** The sandbox's OpenCode sessions, newest first as the service returns them. */
  sessions: OpencodeSession[];
  sessionsLoading: boolean;
  /** A directory to list and create sessions in; null means the service's default. */
  directoryFilter: string | null;
  /** The directory a new session lands in unless the filter names another. */
  sessionDirectory: string;
  /** The repository directories and home OpenCode can work in. */
  directories: string[];
  sessionId: string | null;
  chat: ChatModel | null;
  catalog: OpencodeCatalog | null;

  /** The composer's picks; they apply to the next session or prompt. */
  agent: string;
  model: OpencodeModelRef | null;
  variant: string | null;
  draft: string;

  /** The sandbox's event relay is connected. */
  live: boolean;
  watchBroken: boolean;
};

export type Toast = (kind: 'info' | 'success' | 'error', message: string) => void;

export const initialState = (directory: string | null): PanelState => ({
  sandboxes: [],
  sandboxId: null,
  projectScoped: false,
  loading: true,
  busy: false,
  banner: null,
  directory,
  create: initialCreateState(),
  compactList: true,
  tab: 'sandboxes',
  sessions: [],
  sessionsLoading: false,
  directoryFilter: null,
  sessionDirectory: '',
  directories: [],
  sessionId: null,
  chat: null,
  catalog: null,
  agent: '',
  model: null,
  variant: null,
  draft: '',
  live: false,
  watchBroken: false,
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

/** Drops everything that belonged to the sandbox we just left. */
export const resetSession = (cell: Cell): void => {
  cell.patch({
    sessions: [],
    sessionsLoading: false,
    directoryFilter: null,
    sessionDirectory: '',
    directories: [],
    sessionId: null,
    chat: null,
    catalog: null,
    draft: '',
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
