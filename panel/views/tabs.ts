/** The Sandboxes | Sessions switch, and which panel is showing. */
import { mountTabs } from '@openchamber/sdk/ui';

import type { PanelState } from '../store.ts';
import { isPanelTab, type PanelTab } from '../tab.ts';

export type TabsView = { render: (state: PanelState) => void };

export const createTabsView = (
  roots: { tabs: HTMLElement; sandboxes: HTMLElement; sessions: HTMLElement },
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
        { id: 'sessions', label: 'Sessions', count: state.sessions.length },
      ],
      activeId: state.tab,
    });
    roots.sandboxes.hidden = state.tab !== 'sandboxes';
    roots.sessions.hidden = state.tab !== 'sessions';
  };

  return { render };
};
