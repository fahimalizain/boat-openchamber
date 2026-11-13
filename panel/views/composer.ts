/** The composer's agent, model and reasoning selects, and the message row. */
import { mountSelect, mountTextField } from '@openchamber/sdk/ui';

import { modelsOf, reasoningOf, sortAgents } from '../agents.ts';
import { buttonSlot } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type Composer = { render: (state: PanelState) => void };

export const createComposer = (
  roots: {
    hint: HTMLElement;
    providerRow: HTMLElement;
    provider: HTMLElement;
    model: HTMLElement;
    reasoning: HTMLElement;
    field: HTMLElement;
    actions: HTMLElement;
  },
  handlers: {
    onDraft: (text: string) => void;
    onProvider: (provider: string) => void;
    onModel: (model: string) => void;
    onReasoning: (reasoning: string) => void;
    onSubmit: () => void;
    onInterrupt: () => void;
  },
): Composer => {
  const provider = mountSelect(roots.provider, {
    label: 'Agent',
    value: 'claude',
    options: [],
    onChange: handlers.onProvider,
  });

  const model = mountSelect(roots.model, {
    label: 'Model',
    value: '',
    options: [{ id: '', label: 'Default' }],
    onChange: handlers.onModel,
  });

  const reasoning = mountSelect(roots.reasoning, {
    label: 'Reasoning',
    value: '',
    options: [{ id: '', label: 'Default' }],
    onChange: handlers.onReasoning,
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
    const busy = state.busy;

    roots.providerRow.hidden = open;
    const hint = !state.sandboxId
      ? 'Create a sandbox with `boat new` to start.'
      : open
        ? running ? 'Steer the running turn' : 'Reply'
        : '';
    roots.hint.textContent = hint;
    roots.hint.hidden = hint === '';

    if (!open) {
      const agents = sortAgents(state.agents);
      provider.update({
        value: state.provider,
        options: agents.map((agent) => ({
          id: agent.provider,
          label: agent.available ? agent.label : `${agent.label} (not set up)`,
        })),
        disabled: busy || agents.length === 0,
      });

      const models = modelsOf(state.agents, state.provider);
      model.update({
        value: state.model,
        options: [
          { id: '', label: 'Default' },
          ...models.map((entry) => ({
            id: entry.id,
            label: entry.available ? entry.label : `${entry.label} (not set up)`,
          })),
        ],
        disabled: busy,
      });

      const levels = reasoningOf(state.agents, state.provider, state.model);
      roots.reasoning.hidden = !levels || levels.supported.length === 0;
      if (levels) {
        reasoning.update({
          value: levels.supported.includes(state.reasoning) ? state.reasoning : '',
          options: [
            { id: '', label: 'Default' },
            ...levels.supported.map((level) => ({ id: level, label: level })),
          ],
          disabled: busy,
        });
      }
    }

    send.handle.update({ label: running ? 'Steer' : 'Send', disabled: busy });
    interrupt.slot.hidden = !running;
    interrupt.handle.update({ disabled: busy });
    field.update({
      value: state.draft,
      disabled: busy || !state.sandboxId,
      placeholder: running
        ? 'Add to the running turn…'
        : open
          ? 'Continue this conversation…'
          : 'Ask the sandbox agent…',
    });
  };

  return { render };
};
