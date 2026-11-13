/** Composes the panel's state cell, loaders, actions and live feed behind one API. */
import { createActions, type Actions } from './actions.ts';
import type { ServiceClient } from './api.ts';
import { createLoaders } from './data.ts';
import { createLive, type Live } from './live.ts';
import { createCell, createReporter, initialState, type PanelState } from './state.ts';

export type { BannerState, PanelState } from './state.ts';

export type Store = Actions & Live & {
  getState: () => PanelState;
  subscribe: (listener: () => void) => () => void;
};

export const createStore = (options: {
  client: ServiceClient;
  initialDirectory: string | null;
  toast: (kind: 'info' | 'success' | 'error', message: string) => void;
  openUrl: (url: string) => Promise<void>;
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
  });
  const live = createLive({ cell, client: options.client, loaders, reporter });

  return {
    ...actions,
    ...live,
    getState: cell.get,
    subscribe: cell.subscribe,
  };
};
