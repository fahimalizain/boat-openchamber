/** Builds the client, the store and the views, then wires timers and events. */
import type { HostReadyContext } from '@openchamber/sdk';
import { connectHost } from '@openchamber/sdk';

import { createServiceClient } from './api.ts';
import { byId, buttonSlot } from './kit.ts';
import { createPreferences } from './preferences.ts';
import { createStore } from './store.ts';
import { createBannerView } from './views/banner.ts';
import { createComposer } from './views/composer.ts';
import { createConversationList } from './views/conversation-list.ts';
import { createConversationView } from './views/conversation-view.ts';
import { createConversationsHeader } from './views/conversations-header.ts';
import { createCreateForm } from './views/create-form.ts';
import { createSandboxListView } from './views/sandbox-list.ts';
import { createTabsView } from './views/tabs.ts';

type Host = ReturnType<typeof connectHost>;

export type App = {
  /** The OpenChamber project changed; the project matcher will narrow the list. */
  setDirectory: (directory: string | null) => void;
};

export const startApp = (host: Host, context: HostReadyContext): App => {
  const client = createServiceClient(host);
  const store = createStore({
    client,
    initialDirectory: context.directory,
    toast: (kind, message) => {
      void host.toast({ kind, message }).catch(() => {});
    },
    openUrl: (url) => host.openUrl(url),
    preferences: createPreferences({
      storage: host.storage,
      device: context.features?.deviceStorage === true,
    }),
  });

  const syncProjects = async (): Promise<void> => {
    try {
      const snapshot = await host.listProjects();
      if (snapshot.state !== 'ready') return;
      await client.rememberProjects(snapshot.projects.map((project) => project.directory));
    } catch {
      // The service may be stopped; another open tries again.
    }
  };

  const banner = createBannerView(byId('banner-inner'), byId('banner'));

  const tabs = createTabsView(
    { tabs: byId('tabs'), sandboxes: byId('sandboxes-tab'), conversations: byId('conversations-tab') },
    { onSelect: store.setTab },
  );

  const sandboxList = createSandboxListView(byId('sandbox-list'), {
    onNew: () => store.openCreate('clean'),
    onOpen: (sandboxId) => {
      void store.openSandbox(sandboxId);
    },
    onAction: (sandboxId, action) => {
      if (action === 'copy') store.openCreate('copy', sandboxId);
      else void store.runSandboxAction(action, sandboxId);
    },
  });

  const conversationsHeader = createConversationsHeader(
    {
      select: byId('conv-sandbox-select'),
      state: byId('conv-sandbox-state'),
      banner: byId('conv-resume'),
    },
    {
      onSelect: (sandboxId) => {
        void store.selectSandbox(sandboxId);
      },
      onResume: () => {
        void store.runSandboxAction('resume');
      },
    },
  );

  const list = createConversationList(
    { list: byId('conversation-list'), newButton: byId('new-conversation') },
    {
      onSelect: (conversationId) => {
        void store.selectConversation(conversationId);
      },
      onNew: () => {
        void store.selectConversation(null);
      },
    },
  );

  const conversation = createConversationView(
    {
      chat: byId('chat'),
      empty: byId('chat-empty'),
      status: byId('chat-status'),
      live: byId('live'),
    },
    {
      onNew: () => {
        void store.selectConversation(null);
      },
    },
  );

  const composer = createComposer(
    {
      hint: byId('composer-hint'),
      providerRow: byId('provider-row'),
      provider: byId('provider-select'),
      model: byId('model-select'),
      reasoning: byId('reasoning-select'),
      field: byId('composer-field'),
      actions: byId('composer-actions'),
    },
    {
      onDraft: (text) => store.setDraft(text),
      onProvider: (provider) => store.setProvider(provider),
      onModel: (model) => store.setModel(model),
      onReasoning: (reasoning) => store.setReasoning(reasoning),
      onSubmit: () => {
        void store.submit();
      },
      onInterrupt: () => {
        void store.interrupt();
      },
    },
  );

  const createForm = createCreateForm(
    {
      start: byId('create-start'),
      startHint: byId('create-start-hint'),
      snapshot: byId('create-snapshot'),
      copy: byId('create-copy'),
      environment: byId('create-environment'),
      size: byId('create-size'),
      name: byId('create-name'),
      hours: byId('create-hours'),
      capacity: byId('create-capacity'),
      blocked: byId('create-blocked'),
      submit: byId('create-submit'),
      cancel: byId('create-cancel'),
    },
    {
      onStart: store.setCreateStart,
      onSnapshot: store.setCreateSnapshot,
      onCopy: store.setCreateCopy,
      onEnvironment: store.setCreateEnvironment,
      onSize: store.setCreateSize,
      onName: store.setCreateName,
      onHours: store.setCreateHours,
      onCreate: () => {
        void store.submitCreate();
      },
      onCancel: store.closeCreate,
    },
  );

  const render = (): void => {
    const state = store.getState();
    document.body.dataset.create = state.create.open ? 'true' : 'false';
    document.body.dataset.compactList = state.compactList ? 'true' : 'false';
    banner.render(state.banner);
    tabs.render(state);
    sandboxList.render(state);
    conversationsHeader.render(state);
    list.render(state);
    conversation.render(state);
    composer.render(state);
    createForm.render(state);
  };
  store.subscribe(render);

  buttonSlot(byId('compact-back'), {
    label: '← Back',
    size: 'sm',
    variant: 'ghost',
    onClick: store.showConversationList,
  });

  host.onServiceEvent(({ topic, data }) => store.handleServiceEvent(topic, data));

  window.setInterval(() => store.pingWatch(), 20_000);
  window.setInterval(() => {
    void store.pollRunning();
  }, 4_000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void store.refresh();
    store.refreshAgents();
    void syncProjects();
  });
  window.addEventListener('pagehide', () => {
    store.unwatchCurrent();
    store.persistPreferences();
  });

  render();
  void store.boot();
  void syncProjects();

  return { setDirectory: (directory) => store.setDirectory(directory) };
};
