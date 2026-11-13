/** One sandbox row: what it is, its state, and the actions that fit that state. */
import {
  mountButton,
  mountMenu,
  type ButtonHandle,
  type MenuHandle,
} from '@openchamber/sdk/ui';

import type { ScopedSandboxSummary } from '../../shared/routes.ts';
import { remaining } from '../../shared/time.ts';
import { isBootingState, isStoppedState, isUpState } from '../../shared/types.ts';
import { rowActionsFor, type SandboxMenuAction, type SandboxRowAction } from '../sandbox-actions.ts';
import { el } from '../kit.ts';

const MENU_LABELS: Record<SandboxMenuAction, string> = {
  extend: 'Extend 1h',
  desktop: 'Desktop',
  opencode: 'OpenCode',
  copy: 'Copy',
};

const isMenuAction = (id: string): id is SandboxMenuAction => Object.hasOwn(MENU_LABELS, id);

export type SandboxRowView = {
  element: HTMLElement;
  dispose: () => void;
};

const toneOf = (state: string): string => {
  if (isUpState(state)) return 'success';
  if (isBootingState(state) || state === 'stopping') return 'warning';
  if (isStoppedState(state)) return 'muted';
  return 'error';
};

const metaOf = (sandbox: ScopedSandboxSummary): string => {
  const size = [sandbox.type ?? 'default', sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`]
    .filter(Boolean)
    .join(' ');
  return [
    sandbox.state,
    size,
    sandbox.environment ? `env ${sandbox.environment}` : null,
    isUpState(sandbox.state) ? remaining(sandbox.archiveAfter) || 'no auto-stop' : null,
  ].filter(Boolean).join(' · ');
};

export const createSandboxRow = (
  sandbox: ScopedSandboxSummary,
  options: {
    selected: boolean;
    onOpen: () => void;
    onAction: (action: SandboxRowAction) => void;
  },
): SandboxRowView => {
  const element = el('div', `sandbox-row${options.selected ? ' selected' : ''}`);
  element.tabIndex = 0;
  element.setAttribute('role', 'button');
  element.addEventListener('click', options.onOpen);
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    options.onOpen();
  });

  const main = el('div', 'sandbox-row-main');
  const head = el('div', 'sandbox-row-head');
  head.append(el('span', `dot dot-${toneOf(sandbox.state)}`));
  head.append(el('span', 'sandbox-row-name', sandbox.name || sandbox.id));
  if (sandbox.agentRunning) head.append(el('span', 'sandbox-badge', 'agent running'));
  main.append(head, el('div', 'sandbox-row-meta', metaOf(sandbox)));

  const actionRoot = el('div', 'sandbox-row-actions');
  actionRoot.addEventListener('click', (event) => event.stopPropagation());
  actionRoot.addEventListener('keydown', (event) => event.stopPropagation());

  const actions = rowActionsFor(sandbox.state, sandbox.desktopAvailable);
  const primaryAction = actions.primary;
  let primary: ButtonHandle | null = null;
  let menu: MenuHandle | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  if (primaryAction) {
    const slot = el('div', 'slot');
    actionRoot.append(slot);
    let confirming = false;
    const reset = (): void => {
      confirming = false;
      if (timer) clearTimeout(timer);
      timer = null;
      primary?.update({ label: primaryAction === 'stop' ? 'Stop' : 'Resume' });
    };
    primary = mountButton(slot, {
      label: primaryAction === 'stop' ? 'Stop' : 'Resume',
      size: 'xs',
      variant: primaryAction === 'stop' ? 'destructive' : 'default',
      onClick: () => {
        if (primaryAction === 'stop' && !confirming) {
          confirming = true;
          primary?.update({ label: 'Confirm stop' });
          timer = setTimeout(reset, 4_000);
          return;
        }
        options.onAction(primaryAction);
      },
    });
  }

  if (actions.menu.length > 0) {
    const slot = el('div', 'slot');
    actionRoot.append(slot);
    menu = mountMenu(slot, {
      label: 'More',
      size: 'xs',
      variant: 'ghost',
      items: actions.menu.map((action) => ({ id: action, label: MENU_LABELS[action] })),
      onSelect: (id) => {
        if (isMenuAction(id)) options.onAction(id);
      },
    });
  }

  element.append(main, actionRoot);

  return {
    element,
    dispose: () => {
      if (timer) clearTimeout(timer);
      primary?.dispose();
      menu?.dispose();
      element.remove();
    },
  };
};
