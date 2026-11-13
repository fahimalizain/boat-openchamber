/**
 * The open session's one-line identity, and the switch-session card its header
 * opens: New session, the sandbox's sessions, and the directory filter.
 */
import { mountList, mountSelect } from '@openchamber/sdk/ui';

import { isStoppedState } from '../../shared/types.ts';
import { el } from '../kit.ts';
import { directoryChoices, placeSwitcher, sessionItems } from '../session-pick.ts';
import type { PanelState } from '../store.ts';

export type SessionBarView = { render: (state: PanelState) => void };

export const createSessionBar = (
  root: HTMLElement,
  handlers: {
    onSelect: (sessionId: string) => void;
    onNew: () => void;
    onDirectory: (directory: string) => void;
  },
): SessionBarView => {
  const toggle = el('button', 'session-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-haspopup', 'dialog');
  toggle.setAttribute('aria-expanded', 'false');

  const chevron = el('span', 'session-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  const title = el('span', 'session-title');
  const status = el('span', 'chip session-status');
  const live = el('span', 'live session-live');
  toggle.append(chevron, title, status, live);

  const menu = el('div', 'session-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Switch session');

  const create = el('button', 'session-menu-new');
  create.type = 'button';
  create.append(el('span', 'session-menu-plus', '+'), el('span', 'session-menu-new-label', 'New session'));

  const rows = el('div', 'session-menu-rows');
  const foot = el('div', 'session-menu-foot');
  const directoryRoot = el('div', 'session-menu-directory');
  foot.append(directoryRoot);
  menu.append(create, rows, foot);
  root.append(toggle, menu);

  const list = mountList(rows, {
    items: [],
    onSelect: (sessionId) => {
      close();
      toggle.focus();
      handlers.onSelect(sessionId);
    },
    emptyText: 'No sessions yet.',
    ariaLabel: 'Switch session',
  });

  const directory = mountSelect(directoryRoot, {
    label: 'Directory',
    value: null,
    options: [],
    onChange: (next) => {
      close();
      toggle.focus();
      handlers.onDirectory(next);
    },
  });

  let current: PanelState | null = null;
  let open = false;

  const listNode = (): HTMLElement | null => rows.querySelector<HTMLElement>('.oc-sdk-list');

  const position = (): void => {
    const rect = toggle.getBoundingClientRect();
    const compact = document.documentElement.dataset.layout === 'compact';
    const width = compact ? Math.max(0, window.innerWidth - 16) : Math.round(rect.width);

    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.style.width = `${width}px`;
    menu.style.maxHeight = '';

    const placement = placeSwitcher(
      { left: rect.left, top: rect.top, bottom: rect.bottom, width },
      { width, height: menu.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { compact },
    );

    menu.style.left = `${placement.left}px`;
    menu.style.top = `${placement.top}px`;
    menu.style.width = `${placement.width}px`;
    menu.style.maxHeight = `${placement.maxHeight}px`;
    menu.dataset.above = placement.above ? 'true' : 'false';
  };

  const onOutside = (event: PointerEvent): void => {
    const node = event.target;
    if (!(node instanceof Node)) return;
    if (menu.contains(node) || toggle.contains(node)) return;
    close();
  };
  const onResize = (): void => close();
  const onScroll = (event: Event): void => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    close();
  };
  const onMenuKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      toggle.focus();
      return;
    }
    const onNew = event.target instanceof Node && create.contains(event.target);
    if (onNew && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      listNode()?.focus();
    }
  };
  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && (menu.contains(next) || toggle.contains(next))) return;
    close();
  };

  const bind = (): void => {
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
  };
  const unbind = (): void => {
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll, true);
  };

  const paint = (state: PanelState): void => {
    const session = state.chat?.session
      ?? state.sessions.find((entry) => entry.id === state.sessionId)
      ?? null;

    title.textContent = session?.title ?? 'New session';
    title.title = session?.directory
      ? `${session.title ?? 'New session'}\n${session.directory}`
      : session?.title ?? '';

    const statusOf = session?.status ?? 'idle';
    status.textContent = statusOf;
    status.className = `chip session-status${
      statusOf === 'busy' ? ' is-busy' : statusOf === 'error' ? ' is-error' : ''
    }`;

    live.textContent = state.live ? 'live' : 'offline';
    live.className = `live session-live${state.live ? ' on' : ''}`;

    list.update({
      items: sessionItems(state.sessions),
      selectedId: state.sessionId,
      emptyText: state.sessionsLoading ? 'Loading sessions…' : 'No sessions yet.',
    });

    create.disabled = state.busy || !state.sandboxId;

    const choices = directoryChoices(state.directories, state.sessionDirectory);
    foot.hidden = choices.length <= 1;
    directory.update({
      value: state.directoryFilter ?? (state.sessionDirectory || null),
      options: choices,
      disabled: state.busy,
    });
  };

  const setOpen = (next: boolean): void => {
    if (next === open) return;
    open = next;
    menu.hidden = !next;
    toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (!next) {
      unbind();
      return;
    }
    if (current) paint(current);
    position();
    bind();
    listNode()?.focus({ preventScroll: true });
  };
  const close = (): void => setOpen(false);

  toggle.addEventListener('click', () => setOpen(!open));
  create.addEventListener('click', () => {
    close();
    toggle.focus();
    handlers.onNew();
  });
  menu.addEventListener('keydown', onMenuKey);
  menu.addEventListener('focusout', onFocusOut);

  const render = (state: PanelState): void => {
    current = state;
    const sandbox = state.sandboxes.find((entry) => entry.id === state.sandboxId) ?? null;
    const stopped = sandbox !== null && isStoppedState(sandbox.state);
    const session = state.chat?.session
      ?? state.sessions.find((entry) => entry.id === state.sessionId)
      ?? null;
    const visible = session !== null && state.sandboxId !== null && !stopped;

    root.hidden = !visible;
    if (!visible || state.tab !== 'sessions') {
      close();
      return;
    }

    paint(state);
    if (open) position();
  };

  return { render };
};
