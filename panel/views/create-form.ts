/** The create form: start from, environment, size, name and auto-stop. */
import { mountSelect, mountTextField } from '@openchamber/sdk/ui';

import type { CreateStartKind } from '../../shared/routes.ts';
import {
  blockedReason,
  environmentOptions,
  hoursMax,
  sizeOptions,
  snapshotHint,
  startOptions,
  type CreateState,
} from '../create-state.ts';
import { buttonSlot } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type CreateFormView = { render: (state: PanelState) => void };

const isStartKind = (value: string): value is CreateStartKind => (
  value === 'clean' || value === 'snapshot' || value === 'copy'
);

export const createCreateForm = (
  roots: {
    start: HTMLElement;
    startHint: HTMLElement;
    snapshot: HTMLElement;
    copy: HTMLElement;
    environment: HTMLElement;
    size: HTMLElement;
    name: HTMLElement;
    hours: HTMLElement;
    capacity: HTMLElement;
    blocked: HTMLElement;
    submit: HTMLElement;
    cancel: HTMLElement;
  },
  handlers: {
    onStart: (start: CreateStartKind) => void;
    onSnapshot: (name: string) => void;
    onCopy: (sandboxId: string) => void;
    onEnvironment: (environment: string) => void;
    onSize: (value: string) => void;
    onName: (name: string) => void;
    onHours: (hours: number) => void;
    onCreate: () => void;
    onCancel: () => void;
  },
): CreateFormView => {
  const start = mountSelect(roots.start, {
    label: 'Start from',
    value: 'clean',
    options: [],
    onChange: (id) => {
      if (isStartKind(id)) handlers.onStart(id);
    },
  });

  const snapshot = mountSelect(roots.snapshot, {
    label: 'Snapshot',
    value: null,
    options: [],
    placeholder: 'Pick a snapshot',
    onChange: handlers.onSnapshot,
  });

  const copy = mountSelect(roots.copy, {
    label: 'Sandbox',
    value: null,
    options: [],
    placeholder: 'Pick a sandbox',
    searchable: true,
    onChange: handlers.onCopy,
  });

  const environment = mountSelect(roots.environment, {
    label: 'Environment',
    value: null,
    options: [],
    onChange: handlers.onEnvironment,
  });

  const size = mountSelect(roots.size, {
    label: 'Size',
    value: 'default',
    options: [],
    onChange: handlers.onSize,
  });

  const name = mountTextField(roots.name, {
    label: 'Name',
    value: '',
    placeholder: 'Sandbox name (optional)',
    onChange: handlers.onName,
  });

  const hours = mountTextField(roots.hours, {
    label: 'Auto-stop after',
    value: '1',
    onChange: (value) => handlers.onHours(Number(value)),
  });

  const create = buttonSlot(roots.submit, {
    label: 'Create sandbox',
    size: 'sm',
    onClick: handlers.onCreate,
  });

  const cancel = buttonSlot(roots.cancel, {
    label: 'Cancel',
    size: 'xs',
    variant: 'ghost',
    onClick: handlers.onCancel,
  });

  const render = (state: PanelState): void => {
    const form: CreateState = state.create;
    const options = form.options;
    const busy = form.loading || form.busy;

    start.update({
      value: form.start,
      options: startOptions(options, state.sandboxes),
      disabled: busy,
    });

    const noSnapshots = options !== null && options.snapshots.length === 0;
    roots.startHint.hidden = !(noSnapshots && form.start === 'snapshot');
    roots.startHint.textContent = noSnapshots
      ? 'No saved snapshots yet. Save one with `boat snapshot <id> <name>`.'
      : '';

    roots.snapshot.hidden = form.start !== 'snapshot';
    snapshot.update({
      value: form.snapshot,
      options: (options?.snapshots ?? []).map((saved) => ({
        id: saved.name,
        label: saved.name,
        ...(snapshotHint(saved) ? { hint: snapshotHint(saved) } : {}),
      })),
      disabled: busy,
    });

    roots.copy.hidden = form.start !== 'copy';
    copy.update({
      value: form.copyFrom,
      options: state.sandboxes.map((sandbox) => ({
        id: sandbox.id,
        label: sandbox.name || sandbox.id,
        hint: sandbox.state,
      })),
      disabled: busy,
    });

    environment.update({
      label: 'Environment',
      value: form.start === 'copy' ? form.environment ?? 'inherit' : form.environment,
      options: environmentOptions(form, options, state.sandboxes),
      disabled: busy,
    });

    size.update({
      value: form.size ?? (form.start === 'copy' ? 'source' : 'default'),
      options: sizeOptions(form, options),
      disabled: busy,
    });

    name.update({
      value: form.name,
      disabled: form.busy,
    });

    hours.update({
      value: String(form.autoStopHours),
      helper: `Hours · up to ${hoursMax(options)}`,
      disabled: form.busy,
    });

    roots.capacity.textContent = options
      ? `${options.limits.active ?? 0} of ${options.limits.maxActive ?? '?'} sandboxes running`
      : form.loading
        ? 'Reading the plan…'
        : 'The plan could not be read.';

    const blocked = blockedReason(form, options, state.sandboxes);
    roots.blocked.textContent = blocked ?? '';
    roots.blocked.hidden = !blocked;

    create.handle.update({
      label: form.busy ? 'Creating…' : 'Create sandbox',
      disabled: Boolean(blocked) || busy,
      loading: form.busy,
    });
    cancel.handle.update({ disabled: false });
  };

  return { render };
};
