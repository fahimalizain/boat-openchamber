/** What one project's sidebar mark says, and how marks are diffed. */
import { SERVICE_MARK_TEXT_MAX, type ServiceMark } from '@openchamber/sdk';

import { clip } from '../../shared/json.ts';
import { isUpState, type Sandbox } from '../../shared/types.ts';

export type ProjectMark = Pick<ServiceMark, 'icon' | 'tone' | 'text'>;

export const buildProjectMark = (
  sandboxes: Sandbox[],
  busy: ReadonlySet<string>,
): ProjectMark | null => {
  if (sandboxes.length === 0) return null;

  const running = sandboxes.filter((sandbox) => busy.has(sandbox.id)).length;
  const up = sandboxes.some((sandbox) => isUpState(sandbox.state));
  const text = [
    `${sandboxes.length} sandbox${sandboxes.length === 1 ? '' : 'es'}`,
    running > 0 ? `${running} agent${running === 1 ? '' : 's'} running` : null,
  ].filter(Boolean).join(' · ');

  return {
    icon: 'anchor',
    tone: up || running > 0 ? 'success' : 'info',
    text: clip(text, SERVICE_MARK_TEXT_MAX),
  };
};

export const sameMark = (left: ProjectMark | null, right: ProjectMark | null): boolean => (
  left === right
  || (left !== null && right !== null && left.icon === right.icon && left.tone === right.tone && left.text === right.text)
);

/** Marks to set or clear: a changed value, or a project that no longer has one. */
export const changedMarks = (
  previous: ReadonlyMap<string, ProjectMark | null>,
  next: ReadonlyMap<string, ProjectMark | null>,
): Array<{ directory: string; mark: ProjectMark | null }> => {
  const changes: Array<{ directory: string; mark: ProjectMark | null }> = [];

  for (const [directory, mark] of next) {
    if (!sameMark(previous.get(directory) ?? null, mark)) changes.push({ directory, mark });
  }
  for (const directory of previous.keys()) {
    if (!next.has(directory)) changes.push({ directory, mark: null });
  }

  return changes;
};
