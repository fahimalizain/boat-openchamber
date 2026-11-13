/** The create form: source, what to start from, size, name and auto-stop. */
import { mountSelect, mountTabs, mountTextField, type SelectOption } from '@openchamber/sdk/ui';

import { isSandboxSize, type SandboxSize } from '../../shared/types.ts';
import { blockedReason, hoursMax, sizeOptions, type CreateState } from '../create-state.ts';
import { buttonSlot } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type CreateFormView = { render: (state: PanelState) => void };

const SOURCE_TABS = [
  { id: 'environment', label: 'Environment' },
  { id: 'snapshot', label: 'Snapshot' },
  { id: 'fork', label: 'Fork' },
];

const pickerLabel = (source: CreateState['source']): string => (
  source === 'environment' ? 'Environment' : source === 'snapshot' ? 'Saved snapshot' : 'Sandbox to fork'
);

const pickerValue = (form: CreateState): string | null => (
  form.source === 'environment' ? form.environment : form.source === 'snapshot' ? form.snapshot : form.fork
);

const pickerOptions = (state: PanelState): SelectOption[] => {
  const form = state.create;
  if (form.source === 'environment') {
    return (form.options?.environments ?? []).map((environment) => ({
      id: environment.name,
      label: environment.name,
      ...(environment.isDefault ? { hint: 'default' } : {}),
    }));
  }
  if (form.source === 'snapshot') {
    return (form.options?.snapshots ?? []).map((snapshot) => ({
      id: snapshot.name,
      label: snapshot.name,
      ...(snapshot.type ? { hint: snapshot.type } : {}),
    }));
  }
  return state.sandboxes.map((sandbox) => ({
    id: sandbox.id,
    label: sandbox.name || sandbox.id,
    hint: sandbox.state,
  }));
};

export const createCreateForm = (
  roots: {
    source: HTMLElement;
    picker: HTMLElement;
    size: HTMLElement;
    name: HTMLElement;
    hours: HTMLElement;
    capacity: HTMLElement;
    blocked: HTMLElement;
    submit: HTMLElement;
    cancel: HTMLElement;
  },
  handlers: {
    onSource: (source: CreateState['source']) => void;
    onPick: (value: string) => void;
    onSize: (size: SandboxSize) => void;
    onName: (value: string) => void;
    onHours: (value: number) => void;
    onCreate: () => void;
    onCancel: () => void;
  },
): CreateFormView => {
  const tabs = mountTabs(roots.source, {
    items: SOURCE_TABS,
    activeId: 'environment',
    onChange: (id) => {
      if (id === 'environment' || id === 'snapshot' || id === 'fork') handlers.onSource(id);
    },
  });

  const picker = mountSelect(roots.picker, {
    value: null,
    options: [],
    placeholder: 'Choose…',
    searchable: true,
    onChange: handlers.onPick,
  });

  const size = mountSelect(roots.size, {
    value: 'default',
    options: [],
    onChange: (id) => {
      if (isSandboxSize(id)) handlers.onSize(id);
    },
  });

  const name = mountTextField(roots.name, {
    value: '',
    placeholder: 'Sandbox name (optional)',
    onChange: handlers.onName,
  });

  const hours = mountTextField(roots.hours, {
    value: '1',
    placeholder: '1',
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
    const form = state.create;
    const options = form.options;
    const busy = form.loading || form.busy;

    tabs.update({ items: SOURCE_TABS, activeId: form.source });

    picker.update({
      label: pickerLabel(form.source),
      value: pickerValue(form),
      options: pickerOptions(state),
      placeholder: form.loading ? 'Loading…' : 'Choose…',
      disabled: busy,
    });

    size.update({
      value: form.type,
      options: sizeOptions(options),
      disabled: busy,
    });

    roots.name.hidden = form.source === 'fork';
    name.update({
      value: form.name,
      placeholder: 'Sandbox name (optional)',
      helper: form.source === 'fork' ? undefined : 'Up to 120 characters',
      disabled: form.busy,
    });

    hours.update({
      value: String(form.autoStopHours),
      helper: `1–${hoursMax(options)} hours`,
      disabled: form.busy,
    });

    roots.capacity.textContent = options
      ? `${options.limits.active ?? 0} of ${options.limits.maxActive ?? '?'} sandboxes in use`
      : form.loading
        ? 'Reading the plan…'
        : 'The plan could not be read.';

    const blocked = blockedReason(form, options);
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
