import { mountBanner } from '@openchamber/sdk/ui';

import type { PanelState } from '../store.ts';

export type BannerView = {
  render: (banner: PanelState['banner']) => void;
};

export const createBannerView = (root: HTMLElement, container: HTMLElement): BannerView => {
  const handle = mountBanner(root, { tone: 'info', title: 'Boat' });

  const render = (banner: PanelState['banner']): void => {
    container.hidden = banner === null;
    if (banner) handle.update({ tone: banner.tone, title: banner.title, body: banner.body });
  };

  return { render };
};
