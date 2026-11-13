/** Builds the client, the store and the views, then wires timers and events. */
import type { HostReadyContext } from '@openchamber/sdk';
import { connectHost } from '@openchamber/sdk';

import { createServiceClient } from './api.ts';
import { byId } from './kit.ts';
import { createStore } from './store.ts';
import { createBannerView } from './views/banner.ts';
import { createComposer } from './views/composer.ts';
import { createConversationList } from './views/conversation-list.ts';
import { createConversationView } from './views/conversation-view.ts';
import { createSandboxHeader } from './views/sandbox-header.ts';

type Host = ReturnType<typeof connectHost>;

export type App = {
  /** The OpenChamber project changed; the project matcher will narrow the list. */
  setDirectory: (directory: string | null) => void;
};

export const startApp = (host: Host, context: HostReadyContext): App => {
  const store = createStore({
    client: createServiceClient(host),
    initialDirectory: context.directory,
    toast: (kind, message) => {
      void host.toast({ kind, message }).catch(() => {});
    },
    openUrl: (url) => host.openUrl(url),
  });

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

  const render = (): void => {
    const state = store.getState();
    banner.render(state.banner);
    header.render(state);
    list.render(state);
    conversation.render(state);
    composer.render(state);
  };
  store.subscribe(render);

  host.onServiceEvent(({ topic, data }) => store.handleServiceEvent(topic, data));

  window.setInterval(() => store.pingWatch(), 20_000);
  window.setInterval(() => {
    void store.pollRunning();
  }, 4_000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void store.refresh();
  });
  window.addEventListener('pagehide', () => store.unwatchCurrent());

  render();
  void store.boot();

  return { setDirectory: (directory) => store.setDirectory(directory) };
};
