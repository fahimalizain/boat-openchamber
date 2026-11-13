/** Builds the client, the store and the views, then wires timers and events. */
import type { HostReadyContext } from '@openchamber/sdk';
import { connectHost } from '@openchamber/sdk';

import { createServiceClient } from './api.ts';
import { byId } from './kit.ts';
import { createPreferences } from './preferences.ts';
import { createStore } from './store.ts';
import { createBannerView } from './views/banner.ts';
import { createComposer } from './views/composer.ts';
import { createCreateForm } from './views/create-form.ts';
import { createSandboxListView } from './views/sandbox-list.ts';
import { createSessionBar } from './views/session-bar.ts';
import { createSessionHeader } from './views/session-header.ts';
import { createSessionList } from './views/session-list.ts';
import { createSessionView } from './views/session-view.ts';
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
    { tabs: byId('tabs'), sandboxes: byId('sandboxes-tab'), sessions: byId('sessions-tab') },
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

  const sessionHeader = createSessionHeader(
    {
      select: byId('session-sandbox-select'),
      state: byId('session-sandbox-state'),
      banner: byId('session-resume'),
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

  const sessionList = createSessionList(
    {
      picker: byId('session-picker'),
      list: byId('session-list'),
      newButton: byId('session-new'),
      directory: byId('session-directory'),
      directoryRow: byId('session-directory-row'),
    },
    {
      onSelect: (sessionId) => {
        void store.selectSession(sessionId);
      },
      onNew: () => {
        void store.newSession();
      },
      onDirectory: (directory) => {
        void store.setDirectoryFilter(directory);
      },
    },
  );

  const sessionBar = createSessionBar(byId('session-bar'), {
    onSelect: (sessionId) => {
      void store.selectSession(sessionId);
    },
    onNew: () => {
      void store.newSession();
    },
    onDirectory: (directory) => {
      void store.setDirectoryFilter(directory);
    },
  });

  const sessionView = createSessionView(
    {
      wrap: byId('chat-wrap'),
      chat: byId('chat'),
      log: byId('chat-log'),
      requests: byId('chat-requests'),
      empty: byId('chat-empty'),
    },
    {
      onOpenUrl: (url) => {
        void host.openUrl(url);
      },
      onPermission: (requestId, decision) => {
        void store.respondPermission(requestId, decision);
      },
      onQuestion: (questionId, answer) => {
        void store.respondQuestion(questionId, answer);
      },
      onNew: () => {
        void store.newSession();
      },
    },
  );

  const composer = createComposer(
    {
      root: byId('composer'),
      agent: byId('agent-select'),
      model: byId('model-select'),
      variant: byId('variant-select'),
      field: byId('composer-field'),
      actions: byId('composer-actions'),
    },
    {
      onDraft: (text) => store.setDraft(text),
      onAgent: (agent) => store.setAgent(agent),
      onModel: (model) => store.setModel(model),
      onVariant: (variant) => store.setVariant(variant),
      onSubmit: () => {
        void store.submit();
      },
      onStop: () => {
        void store.stop();
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
    banner.render(state.banner);
    tabs.render(state);
    sandboxList.render(state);
    sessionHeader.render(state);
    sessionList.render(state);
    sessionBar.render(state);
    sessionView.render(state);
    composer.render(state);
    createForm.render(state);
  };
  store.subscribe(render);

  host.onServiceEvent(({ topic, data }) => store.handleServiceEvent(topic, data));

  window.setInterval(() => store.pingWatch(), 30_000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void store.refresh();
    void syncProjects();
  });
  window.addEventListener('pagehide', () => {
    store.unwatchSandbox();
    store.persistPreferences();
  });

  render();
  void store.boot();
  void syncProjects();

  return { setDirectory: (directory) => store.setDirectory(directory) };
};
