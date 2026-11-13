/** The composer: agent, model and reasoning picks, the textarea, Send and Stop. */
import { mountSelect, mountTextField } from '@openchamber/sdk/ui';

import { isStoppedState } from '../../shared/types.ts';
import { agentChoices, groupModels, modelChoices, modelKey, variantsOf } from '../catalog.ts';
import { buttonSlot } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type Composer = { render: (state: PanelState) => void };

export const createComposer = (
  roots: {
    root: HTMLElement;
    agent: HTMLElement;
    model: HTMLElement;
    variant: HTMLElement;
    field: HTMLElement;
    actions: HTMLElement;
  },
  handlers: {
    onDraft: (text: string) => void;
    onAgent: (agent: string) => void;
    onModel: (key: string) => void;
    onVariant: (variant: string) => void;
    onSubmit: () => void;
    onStop: () => void;
  },
): Composer => {
  const agent = mountSelect(roots.agent, {
    label: 'Agent',
    value: null,
    options: [],
    placeholder: 'Default agent',
    onChange: handlers.onAgent,
  });

  const model = mountSelect(roots.model, {
    label: 'Model',
    value: null,
    options: [],
    placeholder: 'Default model',
    searchable: true,
    onChange: handlers.onModel,
  });

  const variant = mountSelect(roots.variant, {
    label: 'Reasoning',
    value: 'default',
    options: [{ id: 'default', label: 'Default' }],
    onChange: handlers.onVariant,
  });

  const field = mountTextField(roots.field, {
    value: '',
    multiline: true,
    rows: 2,
    placeholder: 'Ask OpenCode…',
    onChange: (text) => {
      localDraft = text;
      handlers.onDraft(text);
      paintActions();
    },
  });

  // Send sits at the right edge, so Stop is mounted first.
  const stop = buttonSlot(roots.actions, {
    label: 'Stop',
    size: 'xs',
    variant: 'outline',
    onClick: handlers.onStop,
  });
  const send = buttonSlot(roots.actions, {
    label: 'Send',
    size: 'xs',
    onClick: handlers.onSubmit,
  });

  let lastState: PanelState | null = null;
  let localDraft = '';

  const paintActions = (): void => {
    if (!lastState) return;
    const turning = lastState.chat?.session.status === 'busy';
    const canSend = Boolean(lastState.sandboxId)
      && localDraft.trim().length > 0
      && !lastState.busy
      && !turning;
    send.slot.hidden = turning;
    send.handle.update({ disabled: !canSend });
    stop.slot.hidden = !turning;
    stop.handle.update({ disabled: lastState.busy });
  };

  const textarea = roots.field.querySelector('textarea');
  textarea?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    if (!lastState || lastState.busy) return;
    if (lastState.chat?.session.status === 'busy') return;
    event.preventDefault();
    handlers.onSubmit();
  });

  const render = (state: PanelState): void => {
    lastState = state;
    const sandbox = state.sandboxes.find((entry) => entry.id === state.sandboxId) ?? null;
    const stopped = sandbox !== null && isStoppedState(sandbox.state);

    roots.root.hidden = !state.sandboxId || stopped;
    if (roots.root.hidden) return;

    const turning = state.chat?.session.status === 'busy';
    const locked = state.busy || turning;
    localDraft = state.draft;

    const agents = agentChoices(state.catalog);
    agent.update({
      value: state.agent || null,
      options: agents.map((entry) => ({ id: entry.id, label: entry.label })),
      disabled: locked || agents.length === 0,
    });

    const models = state.catalog?.models ?? [];
    const choices = modelChoices(groupModels(models));
    model.update({
      value: state.model ? modelKey(state.model) : null,
      options: choices,
      disabled: locked || choices.length === 0,
    });

    const levels = variantsOf(models, state.model);
    roots.variant.hidden = levels.length === 0;
    variant.update({
      value: state.variant ?? 'default',
      options: [{ id: 'default', label: 'Default' }, ...levels.map((level) => ({ id: level, label: level }))],
      disabled: locked,
    });

    field.update({
      value: state.draft,
      disabled: locked,
      placeholder: turning ? 'OpenCode is working…' : state.sessionId ? 'Reply, or ask for a change…' : 'Ask OpenCode…',
    });
    paintActions();
  };

  return { render };
};
