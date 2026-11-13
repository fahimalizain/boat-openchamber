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
import { createCreateForm } from './views/create-form.ts';
import { createSandboxHeader } from './views/sandbox-header.ts';

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

  const header = createSandboxHeader(
    {
      groups: byId('sandbox-groups'),
      select: byId('sandbox-select'),
      meta: byId('sandbox-meta'),
      actions: byId('sandbox-actions'),
      live: byId('live'),
    },
    {
      onSelect: (sandboxId) => {
        void store.selectSandbox(sandboxId);
      },
      onAction: (action) => {
        void store.runSandboxAction(action);
      },
      onNew: () => store.openCreate('clean'),
      onCopy: () => {
        const sandboxId = store.getState().sandboxId;
        if (sandboxId) store.openCreate('copy', sandboxId);
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
    { chat: byId('chat'), empty: byId('chat-empty') },
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
      model: byId('model-field'),
      field: byId('composer-field'),
      actions: byId('composer-actions'),
    },
    {
      onDraft: (text) => store.setDraft(text),
      onProvider: (provider) => store.setProvider(provider),
      onModel: (model) => store.setModel(model),
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
    header.render(state);
    list.render(state);
    conversation.render(state);
    composer.render(state);
    createForm.render(state);
  };
  store.subscribe(render);

  buttonSlot(byId('compact-back'), {
    label: '← Conversations',
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
