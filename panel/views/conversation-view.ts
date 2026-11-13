import { mountEmpty } from '@openchamber/sdk/ui';

import type { UiEvent } from '../../shared/types.ts';
import { el } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type ConversationView = { render: (state: PanelState) => void };

const eventNode = (event: UiEvent): HTMLElement => {
  const failed = Boolean(event.error) || event.status === 'failed' || event.status === 'error';
  const node = el('div', `msg ${event.role}${failed ? ' failed' : ''}`);
  const head = el('div', 'msg-head');
  const who = event.type === 'steer'
    ? 'steer'
    : event.role === 'user'
      ? 'you'
      : event.role === 'assistant'
        ? (event.model ?? 'agent')
        : (event.type || 'event');
  head.append(el('span', '', who));
  if (event.status && event.status !== 'running') head.append(el('span', `tag${failed ? ' bad' : ''}`, event.status));
  if (event.streaming) head.append(el('span', 'tag live', 'streaming'));
  node.append(head);

  if (event.tools.length > 0) {
    const tools = el('div', 'tools');
    for (const tool of event.tools) {
      const row = el('div', `tool${tool.isError ? ' failed' : ''}`);
      row.append(el('span', 'tool-name', tool.name));
      if (tool.detail) row.append(el('span', 'tool-detail', tool.detail));
      row.title = tool.detail || tool.name;
      tools.append(row);
    }
    node.append(tools);
  }

  if (event.text) node.append(el('div', 'msg-text', event.text));
  if (event.error) node.append(el('div', 'msg-error', event.error));
  return node;
};

const emptyState = (state: PanelState): { title: string; body: string } => {
  if (state.loading) return { title: 'Loading sandboxes…', body: 'Reading the sandbox list from the boat CLI.' };
  if (!state.sandboxId) return { title: 'No sandboxes', body: 'Create one with `boat new`, then reopen this panel.' };
  if (state.conversations.length === 0) {
    return { title: 'No conversations yet', body: 'Send a prompt below to start one.' };
  }
  return { title: 'Pick a conversation', body: 'Choose a conversation above to see its work.' };
};

export const createConversationView = (
  roots: { chat: HTMLElement; empty: HTMLElement },
  handlers: { onNew: () => void },
): ConversationView => {
  const empty = mountEmpty(roots.empty, {
    title: 'No conversations yet',
    body: 'Send a prompt below to start one.',
    action: { label: 'New conversation', onClick: handlers.onNew },
  });

  let paintedConversation: string | null = null;

  const render = (state: PanelState): void => {
    const open = Boolean(state.conversationId);
    roots.empty.hidden = open;
    roots.chat.hidden = !open;

    if (!open) {
      const next = emptyState(state);
      empty.update({ title: next.title, body: next.body });
      paintedConversation = null;
      return;
    }

    const events = [...state.events.values()].sort((left, right) => (
      left.at - right.at || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    ));
    const nearBottom = roots.chat.scrollTop + roots.chat.clientHeight >= roots.chat.scrollHeight - 40;
    const firstPaint = paintedConversation !== state.conversationId;

    const fragment = document.createDocumentFragment();
    if (events.length === 0) {
      fragment.append(el('div', 'msg system', 'No events yet. The agent writes here as it works.'));
    }
    for (const event of events) fragment.append(eventNode(event));
    roots.chat.replaceChildren(fragment);

    if (firstPaint || nearBottom) roots.chat.scrollTop = roots.chat.scrollHeight;
    paintedConversation = state.conversationId;
  };

  return { render };
};
