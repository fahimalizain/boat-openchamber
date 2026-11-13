/** The Sandboxes tab: New sandbox, project groups, and one row per sandbox. */
import { mountButton } from '@openchamber/sdk/ui';

import { el } from '../kit.ts';
import type { SandboxRowAction } from '../sandbox-actions.ts';
import type { PanelState } from '../store.ts';
import { createSandboxRow, type SandboxRowView } from './sandbox-row.ts';

export type SandboxListView = { render: (state: PanelState) => void };

const PROJECT_HINT =
  'No sandbox for this project. Pin one with the `openchamber.project` label, or add this repository to its boat environment.';

export const createSandboxListView = (
  root: HTMLElement,
  handlers: {
    onNew: () => void;
    onOpen: (sandboxId: string) => void;
    onAction: (sandboxId: string, action: SandboxRowAction) => void;
  },
): SandboxListView => {
  const head = el('div', 'sandbox-list-head');
  const groups = el('div', 'sandbox-groups');
  root.append(head, groups);

  const newButton = mountButton(head, {
    label: 'New sandbox',
    size: 'sm',
    onClick: handlers.onNew,
  });

  let rows: SandboxRowView[] = [];
  let signature = '';

  const render = (state: PanelState): void => {
    newButton.update({ disabled: state.busy });

    const next = `${state.projectScoped ? 1 : 0}#${state.sandboxId ?? ''}#${state.loading ? 1 : 0}#${
      state.sandboxes.map((sandbox) => [
        sandbox.id,
        sandbox.state,
        sandbox.name,
        sandbox.type,
        sandbox.memoryGB,
        sandbox.environment,
        sandbox.archiveAfter,
        sandbox.stoppedAt,
        sandbox.desktopAvailable ? 1 : 0,
        sandbox.agentRunning ? 1 : 0,
        sandbox.inProject ? 1 : 0,
      ].join(':')).join('|')
    }`;
    if (next === signature) return;
    signature = next;

    for (const row of rows) row.dispose();
    rows = [];
    groups.replaceChildren();

    const addGroup = (title: string | null, items: PanelState['sandboxes']): void => {
      if (items.length === 0) return;
      if (title) groups.append(el('div', 'sandbox-group-title', title));
      for (const sandbox of items) {
        const row = createSandboxRow(sandbox, {
          selected: sandbox.id === state.sandboxId,
          onOpen: () => handlers.onOpen(sandbox.id),
          onAction: (action) => handlers.onAction(sandbox.id, action),
        });
        groups.append(row.element);
        rows.push(row);
      }
    };

    if (state.loading && state.sandboxes.length === 0) {
      groups.append(el('div', 'hint', 'Loading sandboxes…'));
      return;
    }

    if (!state.projectScoped) {
      addGroup(null, state.sandboxes);
      if (state.sandboxes.length === 0) {
        groups.append(el('div', 'hint', 'No sandboxes. Create one with `boat new`.'));
      }
      return;
    }

    const project = state.sandboxes.filter((sandbox) => sandbox.inProject);
    const others = state.sandboxes.filter((sandbox) => !sandbox.inProject);
    if (project.length === 0) groups.append(el('div', 'hint', PROJECT_HINT));
    else addGroup('This project', project);
    addGroup('Other sandboxes', others);
  };

  return { render };
};
