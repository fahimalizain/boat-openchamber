import { mountSelect, type SelectOption } from '@openchamber/sdk/ui';

import {
  isStoppedState,
  isUpState,
  type SandboxAction,
  type SandboxSummary,
} from '../../shared/types.ts';
import { clock, remaining } from '../format.ts';
import { buttonSlot } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type SandboxHeader = { render: (state: PanelState) => void };

const hintOf = (sandbox: SandboxSummary): string => {
  const left = isUpState(sandbox.state) ? remaining(sandbox.archiveAfter) : '';
  return left ? `${sandbox.state} · ${left}` : sandbox.state;
};

const metaOf = (sandbox: SandboxSummary): string => {
  const size = [sandbox.type ?? 'default', sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`]
    .filter(Boolean)
    .join(' ');
  const stop = isUpState(sandbox.state) && sandbox.archiveAfter ? `auto-stops ${clock(sandbox.archiveAfter)}` : null;
  return [sandbox.id, size, sandbox.environment ? `env ${sandbox.environment}` : null, stop]
    .filter(Boolean)
    .join(' · ');
};

export const createSandboxHeader = (
  roots: { select: HTMLElement; meta: HTMLElement; actions: HTMLElement; live: HTMLElement },
  handlers: {
    onSelect: (sandboxId: string) => void;
    onAction: (action: SandboxAction) => void;
  },
): SandboxHeader => {
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

  const render = (state: PanelState): void => {
    const sandbox = state.sandboxes.find((entry) => entry.id === state.sandboxId) ?? null;
    select.update({
      value: sandbox?.id ?? null,
      options: state.sandboxes.map((entry): SelectOption => ({
        id: entry.id,
        label: entry.name || entry.id,
        hint: hintOf(entry),
      })),
      disabled: state.busy || state.sandboxes.length === 0,
    });

    roots.meta.textContent = sandbox
      ? metaOf(sandbox)
      : state.loading
        ? 'Loading sandboxes…'
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
  };

  return { render };
};
