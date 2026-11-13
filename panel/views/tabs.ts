/** The Sandboxes | Conversations switch, and which panel is showing. */
import { mountTabs } from '@openchamber/sdk/ui';

import type { PanelState } from '../store.ts';
import { isPanelTab, type PanelTab } from '../tab.ts';

export type TabsView = { render: (state: PanelState) => void };

export const createTabsView = (
  roots: { tabs: HTMLElement; sandboxes: HTMLElement; conversations: HTMLElement },
  handlers: { onSelect: (tab: PanelTab) => void },
): TabsView => {
  const tabs = mountTabs(roots.tabs, {
    items: [],
    activeId: 'sandboxes',
    onChange: (id) => {
      if (isPanelTab(id)) handlers.onSelect(id);
    },
  });

  const render = (state: PanelState): void => {
    tabs.update({
      items: [
        { id: 'sandboxes', label: 'Sandboxes', count: state.sandboxes.length },
        { id: 'conversations', label: 'Conversations', count: state.conversations.length },
      ],
      activeId: state.tab,
    });
    roots.sandboxes.hidden = state.tab !== 'sandboxes';
    roots.conversations.hidden = state.tab !== 'conversations';
  };

  return { render };
};
