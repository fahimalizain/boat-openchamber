/** The session log: projected messages, the open requests, and careful scrolling. */
import { mountEmpty } from '@openchamber/sdk/ui';

import type { OpencodeMessage, OpencodePermissionDecision, OpencodeQuestionAnswer } from '../../shared/opencode.ts';
import { isStoppedState } from '../../shared/types.ts';
import { el } from '../kit.ts';
import type { PanelState } from '../store.ts';
import { createMessageNode } from './message.ts';
import { createPermissionCard, createQuestionCard, type RequestCard } from './request-cards.ts';

export type SessionView = { render: (state: PanelState) => void };

const openDetails = (log: HTMLElement): Set<string> => {
  const keys = new Set<string>();
  for (const node of log.querySelectorAll<HTMLDetailsElement>('details[data-detail]')) {
    if (node.open && node.dataset.detail) keys.add(node.dataset.detail);
  }
  return keys;
};

const restoreDetails = (log: HTMLElement, keys: Set<string>): void => {
  if (keys.size === 0) return;
  for (const node of log.querySelectorAll<HTMLDetailsElement>('details[data-detail]')) {
    if (node.dataset.detail && keys.has(node.dataset.detail)) node.open = true;
  }
};

/** Succeeded idle messages carry nothing; they would only add a blank row. */
const renderable = (message: OpencodeMessage): boolean => (
  message.role !== 'system'
  || Boolean(message.error)
  || Boolean(message.notice)
  || message.parts.some((part) => part.kind === 'text' && part.text.trim().length > 0)
);

const emptyState = (state: PanelState, stopped: boolean): { title: string; body: string } => {
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
  if (stopped) {
    return { title: 'Sandbox stopped', body: 'Resume it above to talk to its OpenCode sessions.' };
  }
  if (state.sessionsLoading && state.sessions.length === 0) {
    return { title: 'Reading OpenCode sessions…', body: 'Asking the sandbox for its sessions and models.' };
  }
  if (state.sessionId && !state.chat) {
    return { title: 'Reading the session…', body: 'Fetching its messages from OpenCode.' };
  }
  if (state.sessions.length === 0) {
    return { title: 'No sessions yet', body: 'Start a session to talk to OpenCode in this sandbox.' };
  }
  return { title: 'Pick a session', body: 'Choose a session above, or start a new one.' };
};

export const createSessionView = (
  roots: {
    wrap: HTMLElement;
    chat: HTMLElement;
    log: HTMLElement;
    requests: HTMLElement;
    empty: HTMLElement;
  },
  handlers: {
    onOpenUrl: (url: string) => void;
    onPermission: (requestId: string, decision: OpencodePermissionDecision) => void;
    onQuestion: (questionId: string, answer: Record<string, OpencodeQuestionAnswer>) => void;
    onNew: () => void;
  },
): SessionView => {
  const empty = mountEmpty(roots.empty, {
    title: 'No session',
    body: 'Start a session to talk to OpenCode in this sandbox.',
    action: { label: 'New session', onClick: handlers.onNew },
  });

  let paintedSession: string | null = null;
  let requestSignature = '';
  let cards: RequestCard[] = [];

  const paintRequests = (state: PanelState): void => {
    const chat = state.chat;
    const permissions = chat?.permissions ?? [];
    const questions = chat?.questions ?? [];
    const signature = chat
      ? `${chat.session.id}#${permissions.map((entry) => entry.id).join(',')}#${questions.map((entry) => entry.id).join(',')}`
      : '';

    if (signature !== requestSignature) {
      requestSignature = signature;
      for (const card of cards) card.dispose();
      cards = [];
      roots.requests.replaceChildren();
      for (const request of permissions) {
        cards.push(createPermissionCard(roots.requests, request, handlers.onPermission));
      }
      for (const question of questions) {
        cards.push(createQuestionCard(roots.requests, question, handlers.onQuestion, handlers.onOpenUrl));
      }
    }

    for (const card of cards) card.update(state.busy);
  };

  const render = (state: PanelState): void => {
    const sandbox = state.sandboxes.find((entry) => entry.id === state.sandboxId) ?? null;
    const stopped = sandbox !== null && isStoppedState(sandbox.state);
    const available = Boolean(state.sandboxId) && !stopped;
    const chat = state.chat;

    roots.wrap.hidden = !available;
    roots.empty.hidden = !available || Boolean(chat);
    roots.chat.hidden = !chat;

    paintRequests(state);
    if (!available) {
      paintedSession = null;
      return;
    }
    if (!chat) {
      const next = emptyState(state, stopped);
      empty.update({
        title: next.title,
        body: next.body,
        action: state.sandboxId ? { label: 'New session', onClick: handlers.onNew } : undefined,
      });
      paintedSession = null;
      return;
    }

    const nearBottom = roots.chat.scrollTop + roots.chat.clientHeight >= roots.chat.scrollHeight - 40;
    const firstPaint = paintedSession !== chat.session.id;
    const opened = openDetails(roots.log);

    const fragment = document.createDocumentFragment();
    if (chat.truncated) {
      fragment.append(el('div', 'msg system', 'Older messages were left out to keep this view quick.'));
    }
    let previous: OpencodeMessage | null = null;
    for (const message of chat.messages) {
      if (!renderable(message)) continue;
      fragment.append(createMessageNode(message, { onOpenUrl: handlers.onOpenUrl }, previous));
      previous = message;
    }
    if (chat.messages.length === 0) {
      fragment.append(el('div', 'msg system', 'No messages yet. Write below to start the turn.'));
    }
    roots.log.replaceChildren(fragment);
    restoreDetails(roots.log, opened);

    if (firstPaint || nearBottom) roots.chat.scrollTop = roots.chat.scrollHeight;
    paintedSession = chat.session.id;
  };

  return { render };
};
