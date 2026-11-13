/** The selected session's one-line identity: title, status, folder and agent/model. */
import { isStoppedState } from '../../shared/types.ts';
import { modelLabel } from '../catalog.ts';
import { el } from '../kit.ts';
import type { PanelState } from '../store.ts';

export type SessionBarView = { render: (state: PanelState) => void };

const folderOf = (directory: string | null): string => {
  if (!directory) return '';
  const parts = directory.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? directory;
};

export const createSessionBar = (root: HTMLElement): SessionBarView => {
  const title = el('span', 'session-title');
  const status = el('span', 'chip session-status');
  const folder = el('span', 'chip mono session-folder');
  const speaker = el('span', 'chip session-speaker');
  const live = el('span', 'live session-live');
  root.append(title, status, folder, speaker, live);

  const render = (state: PanelState): void => {
    const sandbox = state.sandboxes.find((entry) => entry.id === state.sandboxId) ?? null;
    const stopped = sandbox !== null && isStoppedState(sandbox.state);
    const session = state.chat?.session
      ?? state.sessions.find((entry) => entry.id === state.sessionId)
      ?? null;

    root.hidden = !session || !state.sandboxId || stopped;
    if (!session) return;

    title.textContent = session.title ?? 'New session';
    title.title = session.title ?? '';

    status.textContent = session.status;
    status.className = `chip session-status${
      session.status === 'busy' ? ' is-busy' : session.status === 'error' ? ' is-error' : ''
    }`;

    const directory = session.directory ?? '';
    folder.textContent = folderOf(directory);
    folder.title = directory;
    folder.hidden = directory === '';

    const agent = session.agent ?? state.agent ?? '';
    speaker.textContent = [agent, modelLabel(session.model ?? state.model)].filter(Boolean).join(' · ');
    speaker.title = speaker.textContent;

    live.textContent = state.live ? 'live' : 'offline';
    live.className = `live${state.live ? ' on' : ''}`;
  };

  return { render };
};
