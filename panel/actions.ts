/** What the panel asks for: sessions, prompts, stops, answers and sandbox commands. */
import type {
  OpencodeModelRef,
  OpencodePermissionDecision,
  OpencodeQuestionAnswer,
  OpencodeSession,
  OpencodeSessionStatus,
  OpencodeStreamEvent,
} from '../shared/opencode.ts';
import { isUpState, type SandboxAction } from '../shared/types.ts';
import type { ServiceClient } from './api.ts';
import {
  modelRefFromKey,
  modelRefWithVariant,
  settleSelection,
  type Selection,
} from './catalog.ts';
import {
  applyChatEvent,
  applySessionEvent,
  createChatModel,
  withoutPermission,
  withoutQuestion,
} from './chat-model.ts';
import type { Loaders } from './data.ts';
import type { ModelChoice, Preferences, PreferenceStore } from './preferences.ts';
import type { Cell, PanelState, Reporter } from './state.ts';
import { defaultTab, type PanelTab } from './tab.ts';

export type Actions = {
  boot: () => Promise<void>;
  setDirectory: (directory: string | null) => void;
  selectSandbox: (sandboxId: string) => Promise<void>;
  openSandbox: (sandboxId: string) => Promise<void>;
  selectSession: (sessionId: string | null) => Promise<void>;
  newSession: () => Promise<void>;
  setDirectoryFilter: (directory: string) => Promise<void>;
  setTab: (tab: PanelTab) => void;
  setDraft: (text: string) => void;
  setAgent: (agent: string) => void;
  setModel: (key: string) => void;
  setVariant: (variant: string) => void;
  submit: () => Promise<void>;
  stop: () => Promise<void>;
  respondPermission: (requestId: string, decision: OpencodePermissionDecision) => Promise<void>;
  respondQuestion: (questionId: string, answer: Record<string, OpencodeQuestionAnswer>) => Promise<void>;
  runSandboxAction: (action: SandboxAction, sandboxId?: string) => Promise<void>;
  persistPreferences: () => void;
};

const DONE_MESSAGES: Record<SandboxAction, string> = {
  stop: 'Sandbox stopping.',
  resume: 'Sandbox resuming.',
  extend: 'Sandbox extended by an hour.',
  desktop: 'Opening the sandbox desktop.',
  opencode: 'Opening OpenCode.',
};

/** Actions that answer with a URL to open rather than a changed sandbox. */
const OPENS_URL: Partial<Record<SandboxAction, string>> = {
  desktop: 'This sandbox has no desktop to open.',
  opencode: 'OpenCode returned no link.',
};

const talkable = (state: PanelState): boolean => {
  const sandbox = state.sandboxes.find((entry) => entry.id === state.sandboxId) ?? null;
  return sandbox !== null && isUpState(sandbox.state);
};

const statusEvent = (sessionID: string, status: OpencodeSessionStatus): OpencodeStreamEvent => ({
  type: 'status',
  sessionID,
  status,
  error: null,
});

export const createActions = (deps: {
  cell: Cell;
  client: ServiceClient;
  loaders: Loaders;
  reporter: Reporter;
  toast: (kind: 'info' | 'success' | 'error', message: string) => void;
  openUrl: (url: string) => Promise<void>;
  preferences: PreferenceStore;
}): Actions => {
  const { cell, client, loaders, reporter, toast, openUrl, preferences } = deps;

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const savePreferences = (): void => {
    const state = cell.get();
    const model: ModelChoice | null = state.model
      ? { id: state.model.id, providerID: state.model.providerID }
      : null;
    const current: Preferences = {
      sandboxId: state.sandboxId,
      agent: state.agent || null,
      model,
      variant: state.variant,
      tab: state.tab,
    };
    void preferences.save(state.directory, current).catch(() => {});
  };

  const saveModelSoon = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      savePreferences();
    }, 500);
  };

  /** Forces a status without waiting for a stream event; the next event wins. */
  const forceStatus = (sessionID: string, status: OpencodeSessionStatus): void => {
    const state = cell.get();
    const event = statusEvent(sessionID, status);
    cell.patch({
      sessions: applySessionEvent(state.sessions, event),
      ...(state.chat ? { chat: applyChatEvent(state.chat, event) } : {}),
    });
  };

  const applyStoredPreferences = async (
    directory: string | null,
  ): Promise<{ sandboxId: string | null; tab: PanelTab | null }> => {
    const stored = await preferences.get(directory);
    const state = cell.get();
    if (stored) {
      state.agent = stored.agent ?? '';
      state.model = stored.model
        ? { id: stored.model.id, providerID: stored.model.providerID, variant: null }
        : null;
      state.variant = stored.variant;
      if (stored.tab) state.tab = stored.tab;
    }
    const settled: Selection = settleSelection(
      { agent: state.agent, model: state.model, variant: state.variant },
      state.catalog,
    );
    state.agent = settled.agent;
    state.model = settled.model;
    state.variant = settled.variant;
    cell.notify();
    return { sandboxId: stored?.sandboxId ?? null, tab: stored?.tab ?? null };
  };

  /** Load a directory's sandboxes and settle on a tab. */
  const loadForDirectory = async (directory: string | null): Promise<void> => {
    const stored = await applyStoredPreferences(directory);
    await loaders.sandboxes(stored.sandboxId);
    if (!stored.tab) {
      cell.get().tab = defaultTab({
        stored: null,
        sandboxId: cell.get().sandboxId,
        sessions: cell.get().sessions.length,
      });
      cell.notify();
    }
  };

  const refreshAfterAction = async (action: SandboxAction): Promise<void> => {
    await loaders.sandboxes();
    const state = cell.get();
    if ((action === 'stop' || action === 'resume') && state.sandboxId) {
      await loaders.activateSandbox(state.sandboxId);
    }
  };

  const boot = async (): Promise<void> => {
    try {
      await loadForDirectory(cell.get().directory);
      cell.patch({ loading: false, banner: null });
    } catch (failure) {
      cell.patch({ loading: false });
      reporter.fail('Boat could not start', failure);
    }
  };

  const activateSandbox = async (sandboxId: string): Promise<void> => {
    const state = cell.get();
    if (sandboxId === state.sandboxId) return;
    try {
      await loaders.activateSandbox(sandboxId, state.sandboxId);
    } catch (failure) {
      reporter.fail('Could not list sessions', failure);
    }
    savePreferences();
  };

  const selectSandbox = async (sandboxId: string): Promise<void> => {
    if (sandboxId === cell.get().sandboxId) return;
    await activateSandbox(sandboxId);
  };

  const openSandbox = async (sandboxId: string): Promise<void> => {
    await activateSandbox(sandboxId);
    cell.patch({ tab: 'sessions' });
    savePreferences();
  };

  const createSession = async (): Promise<OpencodeSession | null> => {
    const state = cell.get();
    if (!state.sandboxId) return null;
    const model = modelRefWithVariant(state.model, state.variant);
    const answer = await client.createSession({
      sandbox: state.sandboxId,
      ...(state.directoryFilter ? { directory: state.directoryFilter } : {}),
      ...(state.agent ? { agent: state.agent } : {}),
      ...(model ? { model } : {}),
    });

    const current = cell.get();
    if (current.sandboxId !== state.sandboxId) return answer.session;
    current.sessions = [answer.session, ...current.sessions.filter((entry) => entry.id !== answer.session.id)];
    current.sessionId = answer.session.id;
    current.chat = createChatModel({ session: answer.session, messages: [] });
    cell.notify();
    return answer.session;
  };

  const newSession = async (): Promise<void> => {
    const state = cell.get();
    if (!state.sandboxId || state.busy) return;
    if (!talkable(state)) {
      toast('info', 'Resume the sandbox first.');
      return;
    }

    cell.patch({ busy: true });
    try {
      const session = await createSession();
      if (session) {
        toast('success', 'Session started.');
        reporter.setBanner(null);
      }
    } catch (failure) {
      reporter.fail('Could not start a session', failure);
    } finally {
      cell.patch({ busy: false });
    }
  };

  const setDirectoryFilter = async (directory: string): Promise<void> => {
    const state = cell.get();
    if (!state.sandboxId) return;

    state.directoryFilter = directory === state.sessionDirectory ? null : directory;
    state.sessionId = null;
    state.chat = null;
    cell.notify();
    try {
      await loaders.sessions({ autoSelect: true });
    } catch (failure) {
      reporter.fail('Could not list that directory', failure);
    }
  };

  const selectSession = async (sessionId: string | null): Promise<void> => {
    try {
      await loaders.openSession(sessionId);
    } catch (failure) {
      reporter.fail('Could not read that session', failure);
    }
  };

  const submit = async (): Promise<void> => {
    const state = cell.get();
    const sandboxId = state.sandboxId;
    const text = state.draft.trim();
    if (!sandboxId || state.busy) return;
    if (!text) {
      toast('info', 'Write a message first.');
      return;
    }
    if (!talkable(state)) {
      toast('info', 'Resume the sandbox first.');
      return;
    }

    cell.patch({ busy: true });
    try {
      const sessionId = state.sessionId ?? (await createSession())?.id ?? null;
      if (!sessionId) return;

      const current = cell.get();
      const model = modelRefWithVariant(current.model, current.variant);
      await client.prompt({
        sandbox: sandboxId,
        session: sessionId,
        text,
        ...(current.agent ? { agent: current.agent } : {}),
        ...(model ? { model } : {}),
      });

      current.draft = '';
      forceStatus(sessionId, 'busy');
      toast('success', 'Prompt sent.');
      reporter.setBanner(null);
      await loaders.messages(sessionId).catch(() => {
        // The stream fills the turn in; the next open reads it again.
      });
    } catch (failure) {
      reporter.fail('The prompt did not go through', failure);
    } finally {
      cell.patch({ busy: false });
    }
  };

  const stop = async (): Promise<void> => {
    const state = cell.get();
    if (!state.sandboxId || !state.sessionId || state.busy) return;

    const sandboxId = state.sandboxId;
    const sessionId = state.sessionId;
    cell.patch({ busy: true });
    try {
      await client.abort({ sandbox: sandboxId, session: sessionId });
      toast('success', 'Stopped.');
      forceStatus(sessionId, 'idle');
      await loaders.messages(sessionId).catch(() => {});
    } catch (failure) {
      reporter.fail('Could not stop the turn', failure);
    } finally {
      cell.patch({ busy: false });
    }
  };

  const respondPermission = async (
    requestId: string,
    decision: OpencodePermissionDecision,
  ): Promise<void> => {
    const state = cell.get();
    if (!state.sandboxId || !state.sessionId || state.busy) return;

    const { sandboxId, sessionId } = state;
    cell.patch({ busy: true });
    try {
      await client.permission({
        sandbox: sandboxId,
        session: sessionId,
        request: requestId,
        decision,
      });
      const chat = cell.get().chat;
      if (chat) cell.patch({ chat: withoutPermission(chat, requestId) });
      toast('success', decision === 'reject' ? 'Request rejected.' : 'Permission allowed.');
    } catch (failure) {
      reporter.fail('That permission did not go through', failure);
      void loaders.messages().catch(() => {});
    } finally {
      cell.patch({ busy: false });
    }
  };

  const respondQuestion = async (
    questionId: string,
    answer: Record<string, OpencodeQuestionAnswer>,
  ): Promise<void> => {
    const state = cell.get();
    if (!state.sandboxId || !state.sessionId || state.busy) return;

    const { sandboxId, sessionId } = state;
    cell.patch({ busy: true });
    try {
      await client.question({
        sandbox: sandboxId,
        session: sessionId,
        question: questionId,
        answer,
      });
      const chat = cell.get().chat;
      if (chat) cell.patch({ chat: withoutQuestion(chat, questionId) });
      toast('success', 'Answered.');
    } catch (failure) {
      reporter.fail('That answer did not go through', failure);
      void loaders.messages().catch(() => {});
    } finally {
      cell.patch({ busy: false });
    }
  };

  const runSandboxAction = async (action: SandboxAction, sandboxId?: string): Promise<void> => {
    const state = cell.get();
    const target = sandboxId ?? state.sandboxId;
    if (!target || state.busy) return;

    cell.patch({ busy: true });
    if (action === 'opencode') toast('info', 'Starting OpenCode in the sandbox…');
    try {
      const answer = await client.action({ sandbox: target, action });
      const missingUrl = OPENS_URL[action];
      if (missingUrl) {
        if (!answer.url) throw new Error(missingUrl);
        await openUrl(answer.url);
        toast('success', DONE_MESSAGES[action]);
      } else {
        toast('success', DONE_MESSAGES[action]);
        reporter.setBanner(null);
        await refreshAfterAction(action);
      }
    } catch (failure) {
      reporter.fail('That action did not go through', failure);
    } finally {
      cell.patch({ busy: false });
    }
  };

  const retrySessions = (): void => {
    const state = cell.get();
    if (state.tab !== 'sessions' || !state.sandboxId) return;
    if (!talkable(state)) return;
    if (state.sessions.length === 0 && !state.sessionsLoading) {
      void loaders.sessions({ autoSelect: true }).catch((failure: unknown) => {
        reporter.fail('Could not list sessions', failure);
      });
    }
    if (!state.catalog) {
      void loaders.catalog().catch(() => {
        // The next open reads the catalogue again.
      });
    }
    void loaders.retryLive();
  };

  return {
    boot,
    setDirectory: (directory) => {
      const state = cell.get();
      if (directory === state.directory) return;
      state.directory = directory;
      cell.notify();
      void loadForDirectory(directory)
        .catch((failure) => reporter.fail('Could not reload sandboxes', failure));
    },
    selectSandbox,
    openSandbox,
    selectSession,
    newSession,
    setDirectoryFilter,
    setTab: (tab) => {
      cell.patch({ tab });
      savePreferences();
      retrySessions();
    },
    setDraft: (text) => {
      cell.get().draft = text;
    },
    setAgent: (agent) => {
      const state = cell.get();
      if (!agent || agent === state.agent) return;
      state.agent = agent;
      state.variant = null;
      cell.notify();
      savePreferences();
    },
    setModel: (key) => {
      const ref: OpencodeModelRef | null = modelRefFromKey(key);
      if (!ref) return;
      const state = cell.get();
      state.model = ref;
      state.variant = null;
      cell.notify();
      saveModelSoon();
    },
    setVariant: (variant) => {
      const state = cell.get();
      state.variant = variant === 'default' ? null : variant;
      cell.notify();
      savePreferences();
    },
    submit,
    stop,
    respondPermission,
    respondQuestion,
    runSandboxAction,
    persistPreferences: () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      savePreferences();
    },
  };
};
