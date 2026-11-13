import { mountList, type ListItem } from '@openchamber/sdk/ui';

import { clip } from '../../shared/json.ts';
import { timeAgo } from '../../shared/time.ts';
import { buttonSlot } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type ConversationList = { render: (state: PanelState) => void };

export const createConversationList = (
  roots: { list: HTMLElement; newButton: HTMLElement },
  handlers: {
    onSelect: (conversationId: string) => void;
    onNew: () => void;
  },
): ConversationList => {
  const list = mountList(roots.list, {
    items: [],
    onSelect: handlers.onSelect,
    emptyText: 'No conversations yet.',
    ariaLabel: 'Conversations',
  });

  const create = buttonSlot(roots.newButton, {
    label: 'New',
    size: 'xs',
    variant: 'ghost',
    onClick: handlers.onNew,
  });

  const render = (state: PanelState): void => {
    const items: ListItem[] = state.conversations.map((conversation) => {
      const harness = conversation.lastHarness ?? 'agent';
      const model = conversation.lastModel ? ` · ${conversation.lastModel}` : '';
      const prompts = `${conversation.prompts} prompt${conversation.prompts === 1 ? '' : 's'}`;
      const when = timeAgo(conversation.lastPromptAt);
      return {
        id: conversation.id,
        title: clip(`${harness}${model}`, 60),
        subtitle: clip(conversation.lastPromptPreview ?? 'No prompts yet', 110),
        meta: clip(when ? `${prompts} · ${when}` : prompts, 40),
        ...(conversation.running ? { badge: { label: 'running', tone: 'success' as const } } : {}),
      };
    });

    list.update({
      items,
      selectedId: state.conversationId,
      emptyText: state.loading ? 'Loading conversations…' : 'No conversations yet.',
    });
    create.handle.update({ disabled: state.busy });
  };

  return { render };
};
