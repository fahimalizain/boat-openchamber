/** Reads that fill the state: sandboxes, conversations and one conversation's events. */
import type { ServiceClient } from './api.ts';
import { settleConversation } from './selection.ts';
import { resetConversation, type Cell, type Reporter } from './state.ts';
import { messageOf } from './state.ts';

export type Loaders = {
  sandboxes: (preferredSandboxId?: string | null) => Promise<void>;
  conversations: (settings?: { autoSelect?: boolean }) => Promise<void>;
  history: () => Promise<void>;
  openConversation: (conversationId: string | null) => Promise<void>;
};

export const createLoaders = (deps: {
  cell: Cell;
  client: ServiceClient;
  reporter: Reporter;
}): Loaders => {
  const { cell, client, reporter } = deps;

  const history = async (): Promise<void> => {
    const state = cell.get();
    const sandboxId = state.sandboxId;
    const conversationId = state.conversationId;
    if (!sandboxId || !conversationId) return;

    const data = await client.history(sandboxId, conversationId);
    if (cell.get().sandboxId !== sandboxId || cell.get().conversationId !== conversationId) return;
    for (const event of data.events) state.events.set(event.id, event);
    if (data.running !== null) state.running = data.running;
    cell.notify();
  };

  const openConversation = async (conversationId: string | null): Promise<void> => {
    const state = cell.get();
    const previous = state.conversationId;
    if (previous && previous !== conversationId && state.sandboxId) {
      void client.unwatch(state.sandboxId, previous).catch(() => {});
    }

    const running = state.conversations.find((entry) => entry.id === conversationId)?.running ?? false;
    cell.patch({
      conversationId,
      events: new Map(),
      running,
      live: false,
      watchBroken: false,
      compactList: false,
      pendingConversationAt: conversationId && !state.conversations.some((entry) => entry.id === conversationId)
        ? Date.now()
        : null,
    });
    if (!conversationId || !state.sandboxId) return;

    const sandboxId = state.sandboxId;
    try {
      await history();
    } catch (failure) {
      reporter.setBanner({ tone: 'error', title: 'Could not read the conversation', body: messageOf(failure) });
    }
    if (cell.get().sandboxId !== sandboxId || cell.get().conversationId !== conversationId) return;

    try {
      await client.watch(sandboxId, conversationId);
      cell.patch({ live: true, watchBroken: false });
    } catch (failure) {
      cell.patch({ live: false, watchBroken: true });
      reporter.setBanner({ tone: 'warning', title: 'Live updates are off', body: messageOf(failure) });
    }
  };

  const conversations = async (settings: { autoSelect?: boolean } = {}): Promise<void> => {
    const state = cell.get();
    if (!state.sandboxId) {
      cell.patch({ conversations: [], conversationId: null, running: false });
      return;
    }

    const sandboxId = state.sandboxId;
    const data = await client.conversations(sandboxId);
    if (cell.get().sandboxId !== sandboxId) return;

    state.conversations = data.conversations;
    const settled = settleConversation(
      { conversationId: state.conversationId, pendingSince: state.pendingConversationAt },
      data.conversations.map((entry) => entry.id),
    );
    const dropped = settled.conversationId !== state.conversationId;
    state.conversationId = settled.conversationId;
    state.pendingConversationAt = settled.pendingSince;
    if (dropped) {
      state.events = new Map();
      state.live = false;
      state.watchBroken = false;
    }

    const selected = settled.conversationId
      ? data.conversations.find((entry) => entry.id === settled.conversationId) ?? null
      : null;
    state.running = selected?.running ?? false;

    if (!selected && settings.autoSelect !== false) {
      const next = data.conversations.find((entry) => entry.current)
        ?? data.conversations.find((entry) => entry.running)
        ?? data.conversations[0]
        ?? null;
      if (next) return openConversation(next.id);
      if (state.conversationId) return openConversation(null);
    }
    cell.notify();
  };

  const sandboxes = async (preferredSandboxId: string | null = null): Promise<void> => {
    const state = cell.get();
    const data = await client.sandboxes(state.directory);
    state.projectScoped = data.projectScoped;
    const stillThere = state.sandboxId !== null && data.sandboxes.some((entry) => entry.id === state.sandboxId);
    const preferred = preferredSandboxId && data.sandboxes.some((entry) => entry.id === preferredSandboxId)
      ? preferredSandboxId
      : null;
    const nextId = stillThere
      ? state.sandboxId
      : preferred ?? (data.projectScoped
        ? (data.sandboxes.find((entry) => entry.inProject)?.id ?? null)
        : (data.sandboxes[0]?.id ?? null));
    const changed = nextId !== state.sandboxId;

    state.sandboxes = data.sandboxes;
    if (changed) {
      state.sandboxId = nextId;
      resetConversation(cell);
    }
    if (data.error) reporter.setBanner({ tone: 'error', title: 'Boat is unavailable', body: data.error });
    else if (state.banner?.tone === 'error') reporter.setBanner(null);
    cell.notify();

    if (changed) await conversations({ autoSelect: true });
  };

  return { sandboxes, conversations, history, openConversation };
};
