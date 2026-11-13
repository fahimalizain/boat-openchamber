/** Composes the panel's state cell, loaders, actions and live feed behind one API. */
import { createActions, type Actions } from './actions.ts';
import type { ServiceClient } from './api.ts';
import { createCreateActions, type CreateActions } from './create.ts';
import { createLoaders } from './data.ts';
import { createLive, type Live } from './live.ts';
import type { PreferenceStore } from './preferences.ts';
import { createCell, createReporter, initialState, type PanelState } from './state.ts';

export type { BannerState, PanelState } from './state.ts';

export type Store = Actions & CreateActions & Live & {
  getState: () => PanelState;
  subscribe: (listener: () => void) => () => void;
};

export const createStore = (options: {
  client: ServiceClient;
  initialDirectory: string | null;
  toast: (kind: 'info' | 'success' | 'error', message: string) => void;
  openUrl: (url: string) => Promise<void>;
  preferences: PreferenceStore;
}): Store => {
  const cell = createCell(initialState(options.initialDirectory));
  const reporter = createReporter(cell, options.toast);
  const loaders = createLoaders({ cell, client: options.client, reporter });
  const actions = createActions({
    cell,
    client: options.client,
    loaders,
    reporter,
    toast: options.toast,
    openUrl: options.openUrl,
    preferences: options.preferences,
  });
  const create = createCreateActions({
    cell,
    client: options.client,
    toast: options.toast,
    reporter,
    refreshSandboxes: loaders.sandboxes,
    selectSandbox: actions.selectSandbox,
  });
  const live = createLive({
    cell,
    client: options.client,
    loaders,
    reporter,
    onCreate: create.handleCreateProgress,
  });

  return {
    ...actions,
    ...create,
    ...live,
    getState: cell.get,
    subscribe: cell.subscribe,
  };
};
