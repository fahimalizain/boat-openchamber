/**
 * The composer: agent, model and reasoning picks, the pending inbox, image
 * attachments, the textarea, and Send/Steer/Queue with Stop beside them.
 * A turn in flight no longer locks it: Enter steers the running turn.
 */
import { mountButton, mountSelect, mountTextField, type ButtonHandle } from '@openchamber/sdk/ui';

import type { OpencodeInboxDelivery } from '../../shared/opencode.ts';
import { isStoppedState } from '../../shared/types.ts';
import { MAX_ATTACHMENTS, imageFilesOf, isImageFile } from '../attachments.ts';
import { agentChoices, groupModels, modelChoices, modelKey, variantsOf } from '../catalog.ts';
import {
  deliveryLabel,
  inboxSignature,
  inboxSummary,
  toggledDelivery,
} from '../inbox.ts';
import { buttonSlot, el } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type Composer = { render: (state: PanelState) => void };

type InboxRow = { toggle: ButtonHandle; cancel: ButtonHandle };

export const createComposer = (
  roots: {
    root: HTMLElement;
    inbox: HTMLElement;
    attachments: HTMLElement;
    attach: HTMLElement;
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
    onSubmit: (delivery?: OpencodeInboxDelivery | null) => void;
    onAttach: (files: File[]) => void;
    onRemoveAttachment: (id: string) => void;
    onInboxCancel: (id: string) => void;
    onInboxToggle: (id: string) => void;
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

  const picker = el('input', 'attach-input');
  picker.type = 'file';
  picker.accept = 'image/*';
  picker.multiple = true;
  picker.hidden = true;
  picker.addEventListener('change', () => {
    const files = Array.from(picker.files ?? []);
    picker.value = '';
    if (files.length > 0) handlers.onAttach(files);
  });

  const attach = buttonSlot(roots.attach, {
    label: 'Attach',
    size: 'xs',
    variant: 'ghost',
    onClick: () => picker.click(),
  });

  // The action row runs Stop, Send, then the two steer/queue choices at the
  // right edge; only one set is shown at a time.
  const stop = buttonSlot(roots.actions, {
    label: 'Stop',
    size: 'xs',
    variant: 'outline',
    onClick: handlers.onStop,
  });
  const send = buttonSlot(roots.actions, {
    label: 'Send',
    size: 'xs',
    onClick: () => handlers.onSubmit(null),
  });
  const steer = buttonSlot(roots.actions, {
    label: 'Steer',
    size: 'xs',
    onClick: () => handlers.onSubmit('steer'),
  });
  const queue = buttonSlot(roots.actions, {
    label: 'Queue',
    size: 'xs',
    variant: 'outline',
    onClick: () => handlers.onSubmit('queue'),
  });

  let lastState: PanelState | null = null;
  let localDraft = '';
  let paintedInbox = '';
  let paintedAttachments = '';
  let inboxRows: InboxRow[] = [];

  const paintActions = (): void => {
    if (!lastState) return;
    const state = lastState;
    const turning = state.chat?.session.status === 'busy';
    const hasContent = localDraft.trim().length > 0 || state.attachments.length > 0;
    const ready = Boolean(state.sandboxId) && !state.busy && hasContent;

    send.slot.hidden = turning;
    send.handle.update({ disabled: !ready });
    steer.slot.hidden = !turning;
    steer.handle.update({ disabled: !ready });
    queue.slot.hidden = !turning;
    queue.handle.update({ disabled: !ready });
    stop.slot.hidden = !turning;
    stop.handle.update({ disabled: state.busy });
    attach.handle.update({
      disabled: state.busy || state.attachments.length >= MAX_ATTACHMENTS,
    });
  };

  const paintInbox = (state: PanelState): void => {
    const entries = state.inbox;
    roots.inbox.hidden = entries.length === 0;
    const signature = inboxSignature(entries);

    if (signature === paintedInbox) {
      for (const row of inboxRows) {
        row.toggle.update({ disabled: state.busy });
        row.cancel.update({ disabled: state.busy });
      }
      return;
    }

    paintedInbox = signature;
    inboxRows = [];
    roots.inbox.replaceChildren();
    for (const entry of entries) {
      const row = el('div', 'inbox-row');
      row.append(el('span', `chip${entry.delivery === 'steer' ? ' is-busy' : ''}`, deliveryLabel(entry.delivery)));
      const text = el('span', 'inbox-text', inboxSummary(entry));
      text.title = inboxSummary(entry);
      row.append(text);

      const actions = el('div', 'inbox-actions');
      const toggleSlot = el('div', 'slot');
      const cancelSlot = el('div', 'slot');
      actions.append(toggleSlot, cancelSlot);
      row.append(actions);

      const toggle = mountButton(toggleSlot, {
        label: toggledDelivery(entry.delivery) === 'steer' ? 'Steer' : 'Queue',
        size: 'xs',
        variant: 'ghost',
        onClick: () => handlers.onInboxToggle(entry.id),
      });
      const cancel = mountButton(cancelSlot, {
        label: '×',
        size: 'xs',
        variant: 'ghost',
        onClick: () => handlers.onInboxCancel(entry.id),
      });
      toggle.update({ disabled: state.busy });
      cancel.update({ disabled: state.busy });
      inboxRows.push({ toggle, cancel });
      roots.inbox.append(row);
    }
  };

  const paintAttachments = (state: PanelState): void => {
    const signature = state.attachments.map((image) => image.id).join(',');
    roots.attachments.hidden = state.attachments.length === 0;
    if (signature === paintedAttachments) return;

    paintedAttachments = signature;
    roots.attachments.replaceChildren();
    for (const image of state.attachments) {
      const card = el('div', 'attachment');
      card.title = `${image.name} · ${Math.max(1, Math.round(image.bytes / 1024))} KB · ${image.width}×${image.height}`;
      const thumb = el('img', 'attachment-thumb');
      thumb.src = image.preview;
      thumb.alt = image.name;
      card.append(thumb);

      const remove = el('button', 'attachment-remove');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Remove ${image.name}`;
      remove.setAttribute('aria-label', `Remove ${image.name}`);
      remove.addEventListener('click', () => handlers.onRemoveAttachment(image.id));
      card.append(remove);
      roots.attachments.append(card);
    }
  };

  const textarea = roots.field.querySelector('textarea');
  textarea?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    if (!lastState || lastState.busy) return;
    event.preventDefault();
    if (lastState.chat?.session.status !== 'busy') {
      handlers.onSubmit(null);
      return;
    }
    // Enter steers; Cmd/Ctrl+Enter queues for after the turn.
    handlers.onSubmit(event.metaKey || event.ctrlKey ? 'queue' : 'steer');
  });

  textarea?.addEventListener('paste', (event) => {
    const files = imageFilesOf(event.clipboardData?.items ?? null);
    if (files.length === 0) return;
    event.preventDefault();
    handlers.onAttach(files);
  });

  const carriesFiles = (event: DragEvent): boolean => (
    Array.from(event.dataTransfer?.types ?? []).includes('Files')
  );

  roots.root.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    roots.root.dataset.dropping = 'true';
  });
  roots.root.addEventListener('dragleave', (event) => {
    if (event.relatedTarget instanceof Node && roots.root.contains(event.relatedTarget)) return;
    delete roots.root.dataset.dropping;
  });
  roots.root.addEventListener('drop', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    delete roots.root.dataset.dropping;
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => isImageFile(file));
    if (files.length > 0) handlers.onAttach(files);
  });

  roots.root.append(picker);

  const render = (state: PanelState): void => {
    lastState = state;
    const sandbox = state.sandboxes.find((entry) => entry.id === state.sandboxId) ?? null;
    const stopped = sandbox !== null && isStoppedState(sandbox.state);

    roots.root.hidden = !state.sandboxId || stopped;
    if (roots.root.hidden) return;

    const turning = state.chat?.session.status === 'busy';
    localDraft = state.draft;

    const agents = agentChoices(state.catalog);
    agent.update({
      value: state.agent || null,
      options: agents.map((entry) => ({ id: entry.id, label: entry.label })),
      disabled: state.busy || agents.length === 0,
    });

    const models = state.catalog?.models ?? [];
    const choices = modelChoices(groupModels(models));
    model.update({
      value: state.model ? modelKey(state.model) : null,
      options: choices,
      disabled: state.busy || choices.length === 0,
    });

    const levels = variantsOf(models, state.model);
    roots.variant.hidden = levels.length === 0;
    variant.update({
      value: state.variant ?? 'default',
      options: [{ id: 'default', label: 'Default' }, ...levels.map((level) => ({ id: level, label: level }))],
      disabled: state.busy,
    });

    field.update({
      value: state.draft,
      disabled: state.busy,
      placeholder: turning
        ? 'Steer this turn, or queue the next message…'
        : state.sessionId ? 'Reply, or ask for a change…' : 'Ask OpenCode…',
    });
    paintInbox(state);
    paintAttachments(state);
    paintActions();
  };

  return { render };
};
