import { transcriptEntries, type TranscriptEntry } from '../../shared/transcript.ts';
import { mountEmpty } from '@openchamber/sdk/ui';

import { el } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type ConversationView = { render: (state: PanelState) => void };

const entryNode = (entry: TranscriptEntry): HTMLElement => {
  const node = el('div', `msg ${entry.role}${entry.failed ? ' failed' : ''}`);
  const head = el('div', 'msg-head');
  head.append(el('span', '', entry.speaker));
  if (entry.status && entry.status !== 'running') {
    head.append(el('span', `tag${entry.failed ? ' bad' : ''}`, entry.status));
  }
  if (entry.streaming) head.append(el('span', 'tag live', 'streaming'));
  node.append(head);

  if (entry.tools.length > 0) {
    const tools = el('div', 'tools');
    for (const tool of entry.tools) {
      const row = el('div', `tool${tool.isError ? ' failed' : ''}`);
      row.append(el('span', 'tool-name', tool.name));
      if (tool.detail) row.append(el('span', 'tool-detail', tool.detail));
      row.title = tool.detail || tool.name;
      tools.append(row);
    }
    node.append(tools);
  }

  if (entry.text) node.append(el('div', 'msg-text', entry.text));
  if (entry.error) node.append(el('div', 'msg-error', entry.error));
  return node;
};

const emptyState = (state: PanelState): { title: string; body: string } => {
  if (state.loading) return { title: 'Loading sandboxes…', body: 'Reading the sandbox list from the boat CLI.' };
  if (!state.sandboxId) {
    if (state.projectScoped) {
      return {
        title: 'No sandbox for this project',
        body: 'Pin one with the `openchamber.project` label, or add this repository to its boat environment.',
      };
    }
    return { title: 'No sandboxes', body: 'Create one with `boat new`, then reopen this panel.' };
  }
  if (state.conversations.length === 0) {
    return { title: 'No conversations yet', body: 'Send a prompt below to start one.' };
  }
  return { title: 'Pick a conversation', body: 'Choose a conversation above to see its work.' };
};

export const createConversationView = (
  roots: { chat: HTMLElement; empty: HTMLElement; status: HTMLElement; live: HTMLElement },
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
    roots.status.hidden = !open;
    roots.live.textContent = state.live ? 'live' : state.running ? 'polling' : 'paused';
    roots.live.className = `live${state.live ? ' on' : ''}`;

    if (!open) {
      const next = emptyState(state);
      empty.update({ title: next.title, body: next.body });
      paintedConversation = null;
      return;
    }

    const events = transcriptEntries(state.events.values());
    const nearBottom = roots.chat.scrollTop + roots.chat.clientHeight >= roots.chat.scrollHeight - 40;
    const firstPaint = paintedConversation !== state.conversationId;

    const fragment = document.createDocumentFragment();
    if (events.length === 0) {
      fragment.append(el('div', 'msg system', 'No events yet. The agent writes here as it works.'));
    }
    for (const event of events) fragment.append(entryNode(event));
    roots.chat.replaceChildren(fragment);

    if (firstPaint || nearBottom) roots.chat.scrollTop = roots.chat.scrollHeight;
    paintedConversation = state.conversationId;
  };

  return { render };
};
