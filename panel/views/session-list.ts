/**
 * The inline picker the Sessions tab shows while no transcript is open: New
 * session, the directory filter, and one dense row per OpenCode session.
 */
import { mountList, mountSelect } from '@openchamber/sdk/ui';

import { isStoppedState } from '../../shared/types.ts';
import { buttonSlot } from '../kit.ts';
import { directoryChoices, sessionItems, showsInlinePicker } from '../session-pick.ts';
import type { PanelState } from '../store.ts';

export type SessionListView = { render: (state: PanelState) => void };

export const createSessionList = (
  roots: {
    picker: HTMLElement;
    list: HTMLElement;
    newButton: HTMLElement;
    directory: HTMLElement;
    directoryRow: HTMLElement;
  },
  handlers: {
    onSelect: (sessionId: string) => void;
    onNew: () => void;
    onDirectory: (directory: string) => void;
  },
): SessionListView => {
  const list = mountList(roots.list, {
    items: [],
    onSelect: handlers.onSelect,
    emptyText: 'No sessions yet.',
    ariaLabel: 'OpenCode sessions',
  });

  const create = buttonSlot(roots.newButton, {
    label: 'New session',
    size: 'xs',
    variant: 'ghost',
    onClick: handlers.onNew,
  });

  const directory = mountSelect(roots.directory, {
    label: 'Directory',
    value: null,
    options: [],
    onChange: handlers.onDirectory,
  });

  const render = (state: PanelState): void => {
    const sandbox = state.sandboxes.find((entry) => entry.id === state.sandboxId) ?? null;
    const stopped = sandbox !== null && isStoppedState(sandbox.state);
    const shown = showsInlinePicker({
      sandboxId: state.sandboxId,
      stopped,
      sessionId: state.sessionId,
      chat: state.chat !== null,
    });

    roots.picker.hidden = !shown;
    if (!shown) return;

    list.update({
      items: sessionItems(state.sessions),
      selectedId: state.sessionId,
      emptyText: state.sessionsLoading ? 'Loading sessions…' : 'No sessions yet.',
    });
    create.handle.update({ disabled: state.busy || !state.sandboxId });

    const choices = directoryChoices(state.directories, state.sessionDirectory);
    roots.directoryRow.hidden = choices.length <= 1;
    directory.update({
      value: state.directoryFilter ?? (state.sessionDirectory || null),
      options: choices,
      disabled: state.busy,
    });
  };

  return { render };
};
