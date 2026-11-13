/** What arrives from the service: live events, the running poll, and watch pings. */
import { isUiEvent } from '../shared/events.ts';
import { isRecord } from '../shared/json.ts';
import type { ServiceClient } from './api.ts';
import type { Loaders } from './data.ts';
import type { Cell, Reporter } from './state.ts';

export type Live = {
  handleServiceEvent: (topic: string, data: unknown) => void;
  pollRunning: () => Promise<void>;
  pingWatch: () => void;
  unwatchCurrent: () => void;
  refresh: () => Promise<void>;
};

export const createLive = (deps: {
  cell: Cell;
  client: ServiceClient;
  loaders: Loaders;
  reporter: Reporter;
  onCreate: (data: unknown) => void;
}): Live => {
  const { cell, client, loaders, reporter } = deps;
  let polling = false;

  const refreshAfterStreamEnd = async (): Promise<void> => {
    try {
      await loaders.conversations({ autoSelect: false });
      if (cell.get().conversationId) await loaders.history();
    } catch {
      // The next open reads everything again.
    }
  };

  const handleServiceEvent = (topic: string, data: unknown): void => {
    if (topic === 'boat:create') {
      deps.onCreate(data);
      return;
    }
    if (!isRecord(data)) return;
    const state = cell.get();
    const sandbox = typeof data.sandbox === 'string' ? data.sandbox : '';
    const conversation = typeof data.conversation === 'string' ? data.conversation : '';
    if (sandbox !== state.sandboxId || conversation !== state.conversationId) return;

    if (topic === 'boat:events') {
      const incoming = Array.isArray(data.events) ? data.events : [];
      let changed = false;
      for (const entry of incoming) {
        if (!isUiEvent(entry)) continue;
        state.events.set(entry.id, entry);
        changed = true;
      }
      if (changed) cell.notify();
      return;
    }

    if (topic !== 'boat:stream') return;
    const streamState = typeof data.state === 'string' ? data.state : '';
    if (streamState === 'live') {
      cell.patch({ live: true, watchBroken: false });
      return;
    }
    if (streamState !== 'ended' && streamState !== 'error') return;

    cell.patch({ watchBroken: true, live: false });
    if (typeof data.message === 'string' && data.message) {
      reporter.setBanner({ tone: 'warning', title: 'Live updates stopped', body: data.message });
    }
    if (streamState === 'ended') void refreshAfterStreamEnd();
  };

  const pollRunning = async (): Promise<void> => {
    const state = cell.get();
    if (polling || state.busy) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (!state.running || !state.sandboxId || !state.conversationId) return;

    polling = true;
    try {
      const data = await client.conversations(state.sandboxId);
      const current = cell.get();
      if (!current.sandboxId || !current.conversationId) return;
      current.conversations = data.conversations;
      current.running = data.conversations.find((entry) => entry.id === current.conversationId)?.running ?? false;
      await loaders.history();
      cell.notify();
    } catch {
      // A banner already covers a service that is down.
    } finally {
      polling = false;
    }
  };

  const pingWatch = (): void => {
    const state = cell.get();
    if (!state.sandboxId || !state.conversationId || state.watchBroken) return;
    void client.watch(state.sandboxId, state.conversationId).catch(() => {
      cell.patch({ watchBroken: true, live: false });
    });
  };

  const unwatchCurrent = (): void => {
    const state = cell.get();
    if (!state.sandboxId || !state.conversationId) return;
    void client.unwatch(state.sandboxId, state.conversationId).catch(() => {});
  };

  const refresh = async (): Promise<void> => {
    try {
      await loaders.conversations({ autoSelect: false });
      if (cell.get().conversationId) await loaders.history();
    } catch {
      // Quiet: this runs when the panel becomes visible again.
    }
  };

  return { handleServiceEvent, pollRunning, pingWatch, unwatchCurrent, refresh };
};
