/** What arrives from the service: OpenCode event batches, the relay state, creates. */
import { isRecord, readString } from '../shared/json.ts';
import {
  OPENCODE_EVENTS_TOPIC,
  OPENCODE_STREAM_TOPIC,
  type OpencodeStreamEvent,
} from '../shared/opencode.ts';
import { isUpState } from '../shared/types.ts';
import type { ServiceClient } from './api.ts';
import { applyChatEvent, applySessionEvent } from './chat-model.ts';
import type { Loaders } from './data.ts';
import type { Cell, Reporter } from './state.ts';

export type Live = {
  handleServiceEvent: (topic: string, data: unknown) => void;
  pingWatch: () => void;
  unwatchSandbox: () => void;
  refresh: () => Promise<void>;
};

const eventOf = (value: unknown): OpencodeStreamEvent | null => {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  return value as OpencodeStreamEvent;
};

const sessionOf = (event: OpencodeStreamEvent): string | null => {
  if (event.type === 'session-created') return event.session.id;
  if (event.type === 'permission') return event.request.sessionID;
  if (event.type === 'question') return event.request.sessionID;
  return event.sessionID;
};

export const createLive = (deps: {
  cell: Cell;
  client: ServiceClient;
  loaders: Loaders;
  reporter: Reporter;
  onCreate: (data: unknown) => void;
}): Live => {
  const { cell, client, loaders, reporter } = deps;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleMessages = (): void => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void loaders.messages().catch(() => {
        // The next batch or the next open reads the session again.
      });
    }, 400);
  };

  let inboxTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleInbox = (): void => {
    if (inboxTimer) clearTimeout(inboxTimer);
    inboxTimer = setTimeout(() => {
      inboxTimer = null;
      void loaders.inbox().catch(() => {
        // The next prompt or open reads the inbox again.
      });
    }, 250);
  };

  const handleEvents = (events: unknown[]): void => {
    const state = cell.get();
    let sessions = state.sessions;
    let chat = state.chat;
    let sessionId = state.sessionId;
    let changed = false;
    let refetch = false;
    let refetchInbox = false;

    for (const raw of events) {
      const event = eventOf(raw);
      if (!event) continue;

      const nextSessions = applySessionEvent(sessions, event);
      if (nextSessions !== sessions) {
        sessions = nextSessions;
        changed = true;
      }

      if (chat) {
        const nextChat = applyChatEvent(chat, event);
        if (nextChat !== chat) {
          chat = nextChat;
          changed = true;
        }
      }

      const target = sessionOf(event);
      if (event.type === 'message-changed' && target === sessionId) refetch = true;
      if (event.type === 'inbox-changed' && target === sessionId) refetchInbox = true;
      if (event.type === 'session-deleted' && target === sessionId) {
        sessionId = null;
        chat = null;
        changed = true;
      }
    }

    if (changed) cell.patch({ sessions, chat, sessionId });
    if (refetch) scheduleMessages();
    if (refetchInbox) scheduleInbox();
  };

  const handleServiceEvent = (topic: string, data: unknown): void => {
    if (topic === 'boat:create') {
      deps.onCreate(data);
      return;
    }
    if (!isRecord(data)) return;

    const state = cell.get();
    const sandbox = readString(data.sandbox);
    if (sandbox !== state.sandboxId) return;

    if (topic === OPENCODE_EVENTS_TOPIC) {
      handleEvents(Array.isArray(data.events) ? data.events : []);
      return;
    }
    if (topic !== OPENCODE_STREAM_TOPIC) return;

    const streamState = readString(data.state);
    if (streamState === 'live') {
      if (!state.live || state.watchBroken) cell.patch({ live: true, watchBroken: false });
      return;
    }
    if (streamState !== 'ended' && streamState !== 'error') return;

    cell.patch({ live: false, watchBroken: true });
    const message = readString(data.message);
    if (message) reporter.setBanner({ tone: 'warning', title: 'Live updates stopped', body: message });
    if (streamState === 'ended') {
      void loaders.refreshAll().catch(() => {
        // Another open reads everything again.
      });
    }
  };

  const pingWatch = (): void => {
    const state = cell.get();
    if (!state.sandboxId || state.watchBroken) return;
    const sandbox = state.sandboxes.find((entry) => entry.id === state.sandboxId) ?? null;
    if (!sandbox || !isUpState(sandbox.state)) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    void client.watch(state.sandboxId).catch(() => {
      cell.patch({ live: false, watchBroken: true });
    });
  };

  const unwatchSandbox = (): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (inboxTimer) {
      clearTimeout(inboxTimer);
      inboxTimer = null;
    }
    const sandboxId = cell.get().sandboxId;
    if (!sandboxId) return;
    void client.unwatch(sandboxId).catch(() => {});
  };

  const refresh = async (): Promise<void> => {
    try {
      await loaders.refreshAll();
      await loaders.retryLive();
    } catch {
      // Quiet: this runs when the panel becomes visible again.
    }
  };

  return { handleServiceEvent, pingWatch, unwatchSandbox, refresh };
};
