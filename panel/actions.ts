/** What the panel asks for: prompts, steers, interrupts, sandbox commands. */
import type { SandboxAction } from '../shared/types.ts';
import { defaultProvider, modelsOf } from './agents.ts';
import type { ServiceClient } from './api.ts';
import type { Loaders } from './data.ts';
import type { Preferences, PreferenceStore } from './preferences.ts';
import type { Cell, Reporter } from './state.ts';

export type Actions = {
  boot: () => Promise<void>;
  setDirectory: (directory: string | null) => void;
  selectSandbox: (sandboxId: string) => Promise<void>;
  selectConversation: (conversationId: string | null) => Promise<void>;
  setDraft: (text: string) => void;
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setReasoning: (reasoning: string) => void;
  submit: () => Promise<void>;
  interrupt: () => Promise<void>;
  runSandboxAction: (action: SandboxAction) => Promise<void>;
  showConversationList: () => void;
  persistPreferences: () => void;
  refreshAgents: () => void;
};

const DONE_MESSAGES: Record<SandboxAction, string> = {
  stop: 'Sandbox stopping.',
  resume: 'Sandbox resuming.',
  extend: 'Sandbox extended by an hour.',
  desktop: 'Opening the sandbox desktop.',
};

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

  let modelTimer: ReturnType<typeof setTimeout> | null = null;

  const savePreferences = (): void => {
    const state = cell.get();
    const current: Preferences = {
      sandboxId: state.sandboxId,
      provider: state.provider,
      model: state.model,
      reasoning: state.reasoning,
    };
    void preferences.save(state.directory, current).catch(() => {});
  };

  const saveModelSoon = (): void => {
    if (modelTimer) clearTimeout(modelTimer);
    modelTimer = setTimeout(() => {
      modelTimer = null;
      savePreferences();
    }, 500);
  };

  /** Drop a stored agent or model the catalogue no longer offers. */
  const ensureProvider = (): void => {
    const state = cell.get();
    if (state.agents.length === 0) return;
    if (!state.agents.some((agent) => agent.provider === state.provider)) {
      state.provider = defaultProvider(state.agents) ?? 'claude';
      state.model = '';
      state.reasoning = '';
      return;
    }
    if (state.model && !modelsOf(state.agents, state.provider).some((model) => model.id === state.model)) {
      state.model = '';
      state.reasoning = '';
    }
    if (state.model) {
      const reasoning = modelsOf(state.agents, state.provider).find((model) => model.id === state.model)?.reasoning;
      if (state.reasoning && !(reasoning?.supported.includes(state.reasoning) ?? false)) state.reasoning = '';
    }
  };

  const loadAgents = async (): Promise<void> => {
    try {
      cell.get().agents = await client.agents();
      ensureProvider();
      cell.notify();
    } catch {
      // The composer keeps its built-in fallback until the next try.
    }
  };

  const applyStoredPreferences = async (directory: string | null): Promise<string | null> => {
    const stored = await preferences.get(directory);
    const state = cell.get();
    if (stored?.provider) state.provider = stored.provider;
    else if (state.agents.length > 0) state.provider = defaultProvider(state.agents) ?? state.provider;
    if (stored?.model) state.model = stored.model;
    if (stored?.reasoning) state.reasoning = stored.reasoning;
    ensureProvider();
    cell.notify();
    return stored?.sandboxId ?? null;
  };

  const refreshAfterAction = async (): Promise<void> => {
    await loaders.sandboxes();
    await loaders.conversations({ autoSelect: false });
    if (cell.get().conversationId) await loaders.history();
  };

  const boot = async (): Promise<void> => {
    try {
      await loadAgents();
      const preferred = await applyStoredPreferences(cell.get().directory);
      await loaders.sandboxes(preferred);
      cell.patch({ loading: false, banner: null });
    } catch (failure) {
      cell.patch({ loading: false });
      reporter.fail('Boat could not start', failure);
    }
  };

  const selectSandbox = async (sandboxId: string): Promise<void> => {
    const state = cell.get();
    if (sandboxId === state.sandboxId) return;

    const previousSandbox = state.sandboxId;
    const previousConversation = state.conversationId;
    if (previousSandbox && previousConversation) {
      void client.unwatch(previousSandbox, previousConversation).catch(() => {});
    }

    cell.patch({
      sandboxId,
      conversationId: null,
      conversations: [],
      events: new Map(),
      running: false,
      live: false,
      watchBroken: false,
    });

    try {
      await loaders.conversations({ autoSelect: true });
    } catch (failure) {
      reporter.fail('Could not list conversations', failure);
    }
    savePreferences();
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

    const conversationId = state.conversationId;
    const steering = Boolean(conversationId) && state.running;
    cell.patch({ busy: true });

    try {
      if (steering && conversationId) {
        await client.steer({ sandbox: sandboxId, conversation: conversationId, text });
        toast('success', 'Message added to the running turn.');
      } else {
        const model = state.model.trim() || undefined;
        const reasoning = state.reasoning
          && modelsOf(state.agents, state.provider).find((entry) => entry.id === state.model)?.reasoning?.supported.includes(state.reasoning)
          ? state.reasoning
          : undefined;
        const answer = await client.prompt({
          sandbox: sandboxId,
          text,
          ...(conversationId
            ? { conversation: conversationId, provider: state.provider, ...(model ? { model } : {}) }
            : {
              provider: state.provider,
              ...(model ? { model } : {}),
              ...(reasoning ? { reasoning } : {}),
            }),
        });
        toast('success', conversationId ? 'Prompt sent.' : 'Conversation started.');

        cell.get().draft = '';
        await loaders.conversations({ autoSelect: false });
        const next = answer.conversationId
          ?? conversationId
          ?? cell.get().conversations.find((entry) => entry.current)?.id
          ?? cell.get().conversations[0]?.id
          ?? null;
        if (next && next !== cell.get().conversationId) await loaders.openConversation(next);
        else cell.patch({ running: true });
      }

      cell.get().draft = '';
      reporter.setBanner(null);
    } catch (failure) {
      reporter.fail('The prompt did not go through', failure);
    } finally {
      cell.patch({ busy: false });
    }
  };

  const interrupt = async (): Promise<void> => {
    const state = cell.get();
    if (!state.sandboxId || !state.conversationId || state.busy) return;
    cell.patch({ busy: true });
    try {
      await client.interrupt({ sandbox: state.sandboxId, conversation: state.conversationId });
      toast('success', 'Interrupted.');
      await refreshAfterAction();
    } catch (failure) {
      reporter.fail('Could not interrupt', failure);
    } finally {
      cell.patch({ busy: false });
    }
  };

  const runSandboxAction = async (action: SandboxAction): Promise<void> => {
    const state = cell.get();
    if (!state.sandboxId || state.busy) return;
    cell.patch({ busy: true });
    try {
      const answer = await client.action({ sandbox: state.sandboxId, action });
      if (action === 'desktop') {
        if (!answer.url) throw new Error('This sandbox has no desktop to open.');
        await openUrl(answer.url);
        toast('success', DONE_MESSAGES.desktop);
      } else {
        toast('success', DONE_MESSAGES[action]);
        reporter.setBanner(null);
        await refreshAfterAction();
      }
    } catch (failure) {
      reporter.fail('That action did not go through', failure);
    } finally {
      cell.patch({ busy: false });
    }
  };

  return {
    boot,
    setDirectory: (directory) => {
      const state = cell.get();
      if (directory === state.directory) return;
      state.directory = directory;
      cell.notify();
      void (async () => {
        const preferred = await applyStoredPreferences(directory);
        await loaders.sandboxes(preferred);
      })().catch((failure) => reporter.fail('Could not reload sandboxes', failure));
    },
    selectSandbox,
    selectConversation: loaders.openConversation,
    setDraft: (text) => {
      cell.get().draft = text;
    },
    setProvider: (provider) => {
      const state = cell.get();
      if (!provider) return;
      if (state.agents.length > 0 && !state.agents.some((agent) => agent.provider === provider)) return;
      state.provider = provider;
      state.model = '';
      state.reasoning = '';
      cell.notify();
      savePreferences();
    },
    setModel: (model) => {
      cell.get().model = model;
      cell.get().reasoning = '';
      cell.notify();
      saveModelSoon();
    },
    setReasoning: (reasoning) => {
      cell.get().reasoning = reasoning;
      cell.notify();
      savePreferences();
    },
    submit,
    interrupt,
    runSandboxAction,
    showConversationList: () => cell.patch({ compactList: true }),
    refreshAgents: () => {
      void loadAgents();
    },
    persistPreferences: () => {
      if (modelTimer) {
        clearTimeout(modelTimer);
        modelTimer = null;
      }
      savePreferences();
    },
  };
};
