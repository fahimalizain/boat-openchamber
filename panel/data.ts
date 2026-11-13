/** Reads that fill the state: sandboxes, OpenCode sessions, one history, the catalogue. */
import type { OpencodeSessionsResponse } from '../shared/routes.ts';
import { isUpState } from '../shared/types.ts';
import type { ServiceClient } from './api.ts';
import { releaseImages } from './attachments.ts';
import { settleSelection, selectionForSession, type Selection } from './catalog.ts';
import { createChatModel } from './chat-model.ts';
import { messageOf, resetSession, type Cell, type Reporter } from './state.ts';

export type Loaders = {
  sandboxes: (preferredSandboxId?: string | null) => Promise<void>;
  sessions: (settings?: { autoSelect?: boolean }) => Promise<void>;
  messages: (sessionId?: string | null) => Promise<void>;
  /** Re-reads only the open session's pending inbox. */
  inbox: (sessionId?: string | null) => Promise<void>;
  catalog: () => Promise<void>;
  /** Drop the old sandbox and read the new one; the first sandbox included. */
  activateSandbox: (sandboxId: string | null, previous?: string | null) => Promise<void>;
  openSession: (sessionId: string | null) => Promise<void>;
  refreshAll: () => Promise<void>;
  retryLive: () => Promise<void>;
};

export const createLoaders = (deps: {
  cell: Cell;
  client: ServiceClient;
  reporter: Reporter;
}): Loaders => {
  const { cell, client, reporter } = deps;

  const sandboxOf = (sandboxId: string | null) => (
    sandboxId ? cell.get().sandboxes.find((entry) => entry.id === sandboxId) ?? null : null
  );

  const canTalk = (sandboxId: string | null): boolean => {
    const sandbox = sandboxOf(sandboxId);
    return sandbox !== null && isUpState(sandbox.state);
  };

  const watch = async (sandboxId: string): Promise<void> => {
    try {
      await client.watch(sandboxId);
      if (cell.get().sandboxId === sandboxId) cell.patch({ live: true, watchBroken: false });
    } catch (failure) {
      if (cell.get().sandboxId !== sandboxId) return;
      cell.patch({ live: false, watchBroken: true });
      reporter.setBanner({ tone: 'warning', title: 'Live updates are off', body: messageOf(failure) });
    }
  };

  const catalog = async (): Promise<void> => {
    const state = cell.get();
    const sandboxId = state.sandboxId;
    if (!sandboxId || !canTalk(sandboxId)) return;

    const data = await client.catalog(sandboxId);
    const current = cell.get();
    if (current.sandboxId !== sandboxId) return;

    const selection: Selection = settleSelection(
      { agent: current.agent, model: current.model, variant: current.variant },
      data,
    );
    current.catalog = data;
    current.directories = data.directories;
    current.agent = selection.agent;
    current.model = selection.model;
    current.variant = selection.variant;
    cell.notify();
  };

  const messages = async (sessionId: string | null = null): Promise<void> => {
    const state = cell.get();
    const sandboxId = state.sandboxId;
    const wanted = sessionId ?? state.sessionId;
    if (!sandboxId || !wanted) return;

    const data = await client.messages(sandboxId, wanted);
    const current = cell.get();
    if (current.sandboxId !== sandboxId || current.sessionId !== wanted) return;

    const previous = current.sessions.find((session) => session.id === data.session.id) ?? null;
    const session = previous?.status === 'busy' && data.session.status === 'idle'
      ? { ...data.session, status: 'busy' as const }
      : data.session;

    current.chat = createChatModel({
      session,
      messages: data.messages,
      permissions: data.permissions,
      questions: data.questions,
      truncated: data.truncated,
    });
    current.inbox = data.inbox;
    current.sessions = current.sessions.map((entry) => (entry.id === session.id ? session : entry));
    cell.notify();
  };

  const inbox = async (sessionId: string | null = null): Promise<void> => {
    const state = cell.get();
    const sandboxId = state.sandboxId;
    const wanted = sessionId ?? state.sessionId;
    if (!sandboxId || !wanted) return;

    const data = await client.inbox(sandboxId, wanted);
    const current = cell.get();
    if (current.sandboxId !== sandboxId || current.sessionId !== wanted) return;
    current.inbox = data.entries;
    cell.notify();
  };

  const openSession = async (sessionId: string | null): Promise<void> => {
    const state = cell.get();
    if (!state.sandboxId) return;
    if (!sessionId) {
      cell.patch({ sessionId: null, chat: null, inbox: [] });
      return;
    }

    const session = state.sessions.find((entry) => entry.id === sessionId) ?? null;
    const current: Selection = { agent: state.agent, model: state.model, variant: state.variant };
    const selection = session
      ? selectionForSession(session, current, state.catalog)
      : settleSelection(current, state.catalog);

    cell.patch({ sessionId, chat: null, inbox: [], ...selection });
    await messages(sessionId);
  };

  const sessions = async (settings: { autoSelect?: boolean } = {}): Promise<void> => {
    const state = cell.get();
    if (!state.sandboxId) {
      cell.patch({ sessions: [], sessionId: null, chat: null, sessionsLoading: false });
      return;
    }
    if (!canTalk(state.sandboxId)) {
      cell.patch({ sessionsLoading: false });
      return;
    }

    const sandboxId = state.sandboxId;
    cell.patch({ sessionsLoading: true });
    let data: OpencodeSessionsResponse;
    try {
      data = await client.sessions(sandboxId, state.directoryFilter);
    } catch (failure) {
      const current = cell.get();
      if (current.sandboxId === sandboxId) current.sessionsLoading = false;
      cell.notify();
      throw failure;
    }

    const current = cell.get();
    if (current.sandboxId !== sandboxId) return;

    current.sessions = data.sessions;
    current.sessionDirectory = data.directory;
    current.directories = data.directories;
    current.sessionsLoading = false;
    if (current.sessionId && !data.sessions.some((entry) => entry.id === current.sessionId)) {
      current.sessionId = null;
      current.chat = null;
      current.inbox = [];
    }
    const openId = current.sessionId;
    cell.notify();

    if (!openId && settings.autoSelect !== false) {
      const next = data.sessions[0];
      if (next) await openSession(next.id);
    }
  };

  const activateSandbox = async (sandboxId: string | null, previous: string | null = null): Promise<void> => {
    if (previous && previous !== sandboxId) {
      void client.unwatch(previous).catch(() => {});
    }
    releaseImages(cell.get().attachments);
    resetSession(cell);
    cell.patch({ sandboxId });

    if (!sandboxId || !canTalk(sandboxId)) return;

    cell.patch({ sessionsLoading: true });
    await Promise.allSettled([watch(sandboxId), catalog()]);
    await sessions({ autoSelect: true });
  };

  const sandboxes = async (preferredSandboxId: string | null = null): Promise<void> => {
    const state = cell.get();
    const previous = state.sandboxId;
    const data = await client.sandboxes(state.directory);

    state.projectScoped = data.projectScoped;
    const stillThere = previous !== null && data.sandboxes.some((entry) => entry.id === previous);
    const preferred = preferredSandboxId && data.sandboxes.some((entry) => entry.id === preferredSandboxId)
      ? preferredSandboxId
      : null;
    const nextId = stillThere
      ? previous
      : preferred ?? (data.projectScoped
        ? (data.sandboxes.find((entry) => entry.inProject)?.id ?? null)
        : (data.sandboxes[0]?.id ?? null));

    state.sandboxes = data.sandboxes;
    if (data.error) reporter.setBanner({ tone: 'error', title: 'Boat is unavailable', body: data.error });
    else if (state.banner?.tone === 'error') reporter.setBanner(null);
    cell.notify();

    if (nextId !== previous) await activateSandbox(nextId, previous);
  };

  const refreshAll = async (): Promise<void> => {
    await sessions({ autoSelect: false });
    const current = cell.get();
    if (current.sessionId) await messages();
    await catalog().catch(() => {
      // The composer keeps the picks it had; the next open reads the catalogue again.
    });
  };

  const retryLive = async (): Promise<void> => {
    const state = cell.get();
    if (!state.sandboxId || !canTalk(state.sandboxId)) return;
    if (state.live) return;
    await watch(state.sandboxId);
  };

  return { sandboxes, sessions, messages, inbox, catalog, activateSandbox, openSession, refreshAll, retryLive };
};
