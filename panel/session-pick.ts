/**
 * The session switcher's pure parts: the row order and shape, when the inline
 * picker stands in for a transcript, and where the card sits under its header.
 */
import type { ListItem } from '@openchamber/sdk/ui';

import type { OpencodeSession } from '../shared/opencode.ts';
import { clip } from '../shared/json.ts';
import { timeAgoAt } from '../shared/time.ts';

/** The last path segment, for a directory that reads as a chip. */
export const folderOf = (directory: string | null): string => {
  if (!directory) return '';
  const parts = directory.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? directory;
};

/**
 * Busy sessions first, then the most recently updated. OpenCode answers newest
 * first; this only lifts the ones that are doing something above the rest.
 */
export const orderSessions = (sessions: readonly OpencodeSession[]): OpencodeSession[] => (
  [...sessions].sort((left, right) => {
    const busy = Number(right.status === 'busy') - Number(left.status === 'busy');
    return busy || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
  })
);

const badgeOf = (session: OpencodeSession): ListItem['badge'] => {
  if (session.status === 'busy') return { label: 'busy', tone: 'success' };
  if (session.status === 'error') return { label: 'error', tone: 'error' };
  return { label: 'idle', tone: 'neutral' };
};

/** One dense row per session, in switcher order and current first-class state. */
export const sessionItems = (sessions: readonly OpencodeSession[]): ListItem[] => (
  orderSessions(sessions).map((session) => ({
    id: session.id,
    title: clip(session.title ?? 'New session', 70),
    meta: timeAgoAt(session.updatedAt),
    badge: badgeOf(session),
  }))
);

export type DirectoryChoice = { id: string; label: string; hint: string };

/** The directories worth offering; the session default when the list is empty. */
export const directoryChoices = (
  directories: readonly string[],
  sessionDirectory: string,
): DirectoryChoice[] => {
  const list = directories.length > 0
    ? directories
    : (sessionDirectory ? [sessionDirectory] : []);
  return list.map((entry) => ({ id: entry, label: folderOf(entry), hint: entry }));
};

export const showsInlinePicker = (input: {
  sandboxId: string | null;
  stopped: boolean;
  /** A session is selected; its transcript is loading or open. */
  sessionId: string | null;
  /** The transcript model has arrived. */
  chat: boolean;
}): boolean => (
  input.sandboxId !== null
  && !input.stopped
  && input.sessionId === null
  && !input.chat
);

export type SwitcherAnchor = { left: number; top: number; bottom: number; width: number };
export type SwitcherSize = { width: number; height: number };
export type SwitcherViewport = { width: number; height: number };
export type SwitcherPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  /** True when the card had to open upwards. */
  above: boolean;
};

const GAP = 4;
const MARGIN = 8;

/**
 * Places the card under the header, flipping above when the room below cannot
 * hold it and the room above is larger. A compact (phone) card spans the
 * viewport instead of the header.
 */
export const placeSwitcher = (
  anchor: SwitcherAnchor,
  size: SwitcherSize,
  viewport: SwitcherViewport,
  options: { compact?: boolean } = {},
): SwitcherPlacement => {
  const room = Math.max(0, viewport.width - MARGIN * 2);
  const width = options.compact
    ? room
    : Math.min(Math.max(size.width, anchor.width), room);

  const roomBelow = Math.max(0, viewport.height - anchor.bottom - GAP - MARGIN);
  const roomAbove = Math.max(0, anchor.top - GAP - MARGIN);
  const above = size.height > roomBelow && roomAbove > roomBelow;
  const maxHeight = above ? roomAbove : roomBelow;
  const height = Math.min(size.height, maxHeight);
  const top = above ? Math.max(MARGIN, anchor.top - GAP - height) : anchor.bottom + GAP;

  const left = Math.min(
    Math.max(MARGIN, options.compact ? MARGIN : anchor.left),
    Math.max(MARGIN, viewport.width - width - MARGIN),
  );

  return { left, top, width, maxHeight, above };
};
