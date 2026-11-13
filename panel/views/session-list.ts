/** The sessions list: a directory filter, New session, and one row per OpenCode session. */
import { mountList, mountSelect, type ListItem } from '@openchamber/sdk/ui';

import { clip } from '../../shared/json.ts';
import { timeAgoAt } from '../../shared/time.ts';
import { buttonSlot } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type SessionListView = { render: (state: PanelState) => void };

const folderOf = (directory: string | null): string => {
  if (!directory) return '';
  const parts = directory.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? directory;
};

const badgeOf = (session: PanelState['sessions'][number]): ListItem['badge'] => {
  if (session.status === 'busy') return { label: 'busy', tone: 'success' };
  if (session.status === 'error') return { label: 'error', tone: 'error' };
  return { label: 'idle', tone: 'neutral' };
};

export const createSessionList = (
  roots: { list: HTMLElement; newButton: HTMLElement; directory: HTMLElement },
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
    const items: ListItem[] = state.sessions.map((session) => ({
      id: session.id,
      title: clip(session.title ?? 'New session', 70),
      meta: timeAgoAt(session.updatedAt),
      badge: badgeOf(session),
    }));

    list.update({
      items,
      selectedId: state.sessionId,
      emptyText: state.sessionsLoading ? 'Loading sessions…' : 'No sessions yet.',
    });
    create.handle.update({ disabled: state.busy || !state.sandboxId });

    const directories = state.directories.length > 0
      ? state.directories
      : (state.sessionDirectory ? [state.sessionDirectory] : []);
    roots.directory.hidden = directories.length <= 1;
    directory.update({
      value: state.directoryFilter ?? (state.sessionDirectory || null),
      options: directories.map((entry) => ({ id: entry, label: folderOf(entry), hint: entry })),
      disabled: state.busy,
    });
  };

  return { render };
};
