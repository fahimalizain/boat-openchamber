import { mountSelect, mountTextField, type SelectOption } from '@openchamber/sdk/ui';

import { AGENT_PROVIDERS } from '../../shared/agent.ts';
import { buttonSlot } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type Composer = { render: (state: PanelState) => void };

export const createComposer = (
  roots: {
    hint: HTMLElement;
    providerRow: HTMLElement;
    provider: HTMLElement;
    model: HTMLElement;
    field: HTMLElement;
    actions: HTMLElement;
  },
  handlers: {
    onDraft: (text: string) => void;
    onProvider: (provider: string) => void;
    onModel: (model: string) => void;
    onSubmit: () => void;
    onInterrupt: () => void;
  },
): Composer => {
  const provider = mountSelect(roots.provider, {
    value: 'claude',
    options: AGENT_PROVIDERS.map((id): SelectOption => ({ id, label: id })),
    placeholder: 'Provider',
    onChange: handlers.onProvider,
  });

  const model = mountTextField(roots.model, {
    value: '',
    placeholder: 'Model (optional)',
    onChange: handlers.onModel,
  });

  const field = mountTextField(roots.field, {
    value: '',
    multiline: true,
    rows: 3,
    placeholder: 'Ask the sandbox agent…',
    onChange: handlers.onDraft,
  });

  // Send sits at the right edge, so Interrupt is mounted first.
  const interrupt = buttonSlot(roots.actions, {
    label: 'Interrupt',
    size: 'sm',
    variant: 'outline',
    onClick: handlers.onInterrupt,
  });
  const send = buttonSlot(roots.actions, {
    label: 'Send',
    size: 'sm',
    onClick: handlers.onSubmit,
  });

  const render = (state: PanelState): void => {
    const open = Boolean(state.conversationId);
    const running = open && state.running;

    roots.providerRow.hidden = open;
    roots.hint.textContent = !state.sandboxId
      ? 'Create a sandbox with `boat new` to start.'
      : open
        ? running ? 'Steer the running turn' : 'Reply in this conversation'
        : 'New conversation';

    provider.update({ value: state.provider });
    send.handle.update({ label: running ? 'Steer' : 'Send', disabled: state.busy });
    interrupt.slot.hidden = !running;
    interrupt.handle.update({ disabled: state.busy });
    field.update({
      value: state.draft,
      disabled: state.busy || !state.sandboxId,
      placeholder: running
        ? 'Add to the running turn…'
        : open
          ? 'Continue this conversation…'
          : 'Ask the sandbox agent…',
    });
    model.update({ value: state.model, disabled: state.busy });
  };

  return { render };
};
