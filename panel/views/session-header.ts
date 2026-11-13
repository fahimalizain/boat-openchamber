/** The Sessions tab's small header: which sandbox, and a Resume when stopped. */
import { mountBanner, mountSelect } from '@openchamber/sdk/ui';

import { remaining } from '../../shared/time.ts';
import { isStoppedState, isUpState } from '../../shared/types.ts';
import type { PanelState } from '../store.ts';

export type SessionHeaderView = { render: (state: PanelState) => void };

export const createSessionHeader = (
  roots: { select: HTMLElement; state: HTMLElement; banner: HTMLElement },
  handlers: { onSelect: (sandboxId: string) => void; onResume: () => void },
): SessionHeaderView => {
  const select = mountSelect(roots.select, {
    value: null,
    options: [],
    placeholder: 'Sandbox',
    searchable: true,
    onChange: handlers.onSelect,
  });

  mountBanner(roots.banner, {
    tone: 'warning',
    title: 'Sandbox stopped',
    body: 'Resume it to talk to its OpenCode sessions.',
    action: { label: 'Resume', onClick: handlers.onResume },
  });

  const render = (state: PanelState): void => {
    const sandbox = state.sandboxes.find((entry) => entry.id === state.sandboxId) ?? null;

    select.update({
      value: sandbox?.id ?? null,
      options: state.sandboxes.map((entry) => ({
        id: entry.id,
        label: entry.name || entry.id,
        hint: entry.state,
      })),
      disabled: state.busy || state.sandboxes.length === 0,
    });

    roots.state.textContent = sandbox
      ? [sandbox.state, isUpState(sandbox.state) ? remaining(sandbox.archiveAfter) : ''].filter(Boolean).join(' · ')
      : state.loading ? 'Loading…' : 'No sandbox';

    roots.banner.hidden = !(sandbox && isStoppedState(sandbox.state));
  };

  return { render };
};
