import { mountSelect, mountTabs, type SelectOption } from '@openchamber/sdk/ui';

import {
  isStoppedState,
  isUpState,
  type SandboxAction,
} from '../../shared/types.ts';
import { clock, remaining } from '../../shared/time.ts';
import { buttonSlot } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type SandboxHeader = { render: (state: PanelState) => void };

type Group = 'project' | 'other';

const hintOf = (sandbox: PanelState['sandboxes'][number]): string => {
  const left = isUpState(sandbox.state) ? remaining(sandbox.archiveAfter) : '';
  return left ? `${sandbox.state} · ${left}` : sandbox.state;
};

const metaOf = (sandbox: PanelState['sandboxes'][number]): string => {
  const size = [sandbox.type ?? 'default', sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`]
    .filter(Boolean)
    .join(' ');
  const stop = isUpState(sandbox.state) && sandbox.archiveAfter ? `auto-stops ${clock(sandbox.archiveAfter)}` : null;
  return [sandbox.id, size, sandbox.environment ? `env ${sandbox.environment}` : null, stop]
    .filter(Boolean)
    .join(' · ');
};

export const createSandboxHeader = (
  roots: { groups: HTMLElement; select: HTMLElement; meta: HTMLElement; actions: HTMLElement; live: HTMLElement },
  handlers: {
    onSelect: (sandboxId: string) => void;
    onAction: (action: SandboxAction) => void;
  },
): SandboxHeader => {
  let group: Group = 'project';
  let lastState: PanelState | null = null;
  let lastSandboxId: string | null = null;

  const tabs = mountTabs(roots.groups, {
    items: [],
    activeId: group,
    onChange: (id) => {
      group = id === 'other' ? 'other' : 'project';
      if (lastState) render(lastState);
    },
  });

  const select = mountSelect(roots.select, {
    value: null,
    options: [],
    placeholder: 'Sandbox',
    searchable: true,
    onChange: handlers.onSelect,
  });

  const stop = buttonSlot(roots.actions, {
    label: 'Stop',
    size: 'sm',
    variant: 'destructive',
    onClick: () => handlers.onAction('stop'),
  });
  const extend = buttonSlot(roots.actions, {
    label: 'Extend 1h',
    size: 'sm',
    variant: 'outline',
    onClick: () => handlers.onAction('extend'),
  });
  const desktop = buttonSlot(roots.actions, {
    label: 'Desktop',
    size: 'sm',
    variant: 'outline',
    onClick: () => handlers.onAction('desktop'),
  });
  const resume = buttonSlot(roots.actions, {
    label: 'Resume',
    size: 'sm',
    onClick: () => handlers.onAction('resume'),
  });
  const buttons = [stop, extend, desktop, resume];

  function render(state: PanelState): void {
    lastState = state;
    const inProject = state.sandboxes.filter((entry) => entry.inProject);
    const others = state.sandboxes.filter((entry) => !entry.inProject);
    const grouped = state.projectScoped && others.length > 0;

    if (state.sandboxId !== lastSandboxId) {
      lastSandboxId = state.sandboxId;
      if (grouped && state.sandboxId) {
        group = inProject.some((entry) => entry.id === state.sandboxId) ? 'project' : 'other';
      }
    }
    if (grouped && inProject.length === 0) group = 'other';

    roots.groups.hidden = !grouped;
    if (grouped) {
      tabs.update({
        items: [
          { id: 'project', label: 'This project', count: inProject.length },
          { id: 'other', label: 'Other sandboxes', count: others.length },
        ],
        activeId: group,
      });
    }

    const visible = !grouped ? state.sandboxes : group === 'project' ? inProject : others;
    const sandbox = state.sandboxes.find((entry) => entry.id === state.sandboxId) ?? null;

    select.update({
      value: sandbox?.id ?? null,
      options: visible.map((entry): SelectOption => ({
        id: entry.id,
        label: entry.name || entry.id,
        hint: hintOf(entry),
      })),
      disabled: state.busy || visible.length === 0,
    });

    roots.meta.textContent = sandbox
      ? metaOf(sandbox)
      : state.loading
        ? 'Loading sandboxes…'
        : grouped
          ? 'No sandbox for this project'
          : 'No sandboxes';

    const up = sandbox ? isUpState(sandbox.state) : false;
    const stopped = sandbox ? isStoppedState(sandbox.state) : false;
    stop.slot.hidden = !up;
    extend.slot.hidden = !up;
    desktop.slot.hidden = !up || sandbox?.desktopAvailable !== true;
    resume.slot.hidden = !stopped;
    for (const button of buttons) button.handle.update({ disabled: state.busy });

    roots.live.hidden = !state.conversationId;
    roots.live.textContent = state.live ? 'live' : state.running ? 'polling' : 'paused';
    roots.live.className = `live${state.live ? ' on' : ''}`;
  }

  return { render };
};
