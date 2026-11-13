/** One row per cached OpenCode session and one per sandbox; pure and quick for the 2 s menu. */
import type { MentionsItem } from '@openchamber/sdk';

import { clip } from '../../shared/json.ts';
import type { OpencodeSession } from '../../shared/opencode.ts';
import { remaining, timeAgoAt } from '../../shared/time.ts';
import { isUpState, type Sandbox } from '../../shared/types.ts';
import { isOpencodeSessionId, isSandboxId } from '../validation.ts';

export const MENTION_ROW_MAX = 20;
export const MENTION_TEXT_MAX = 120;

export type MentionRowsInput = {
  sandboxes: Sandbox[];
  sessions: (sandboxId: string) => OpencodeSession[] | null;
  /** Sandbox ids in the request's project, when it named one and we have ranked it. */
  projectIds: ReadonlySet<string> | null;
  query: string;
};

export const mentionSandboxId = (sandboxId: string): string => `sandbox:${sandboxId}`;

export const mentionSessionId = (sandboxId: string, sessionId: string): string => (
  `session:${sandboxId}:${sessionId}`
);

export type ParsedMention =
  | { kind: 'sandbox'; sandboxId: string }
  | { kind: 'session'; sandboxId: string; sessionId: string };

export const parseMentionId = (id: string | null): ParsedMention | null => {
  if (!id) return null;
  const [kind, sandboxId, sessionId] = id.split(':');
  if (!isSandboxId(sandboxId)) return null;
  if (kind === 'sandbox') return { kind, sandboxId };
  if (kind === 'session' && isOpencodeSessionId(sessionId)) {
    return { kind, sandboxId, sessionId };
  }
  return null;
};

const sessionSubtitle = (sandbox: Sandbox, session: OpencodeSession): string => {
  const agent = session.agent ?? 'agent';
  const model = session.model ? `/${session.model.id}` : '';
  return [
    sandbox.name || sandbox.id,
    `${agent}${model}`,
    session.status,
    timeAgoAt(session.updatedAt),
  ].filter(Boolean).join(' · ');
};

const sandboxSubtitle = (sandbox: Sandbox): string => {
  const left = isUpState(sandbox.state) ? remaining(sandbox.archiveAfter) : '';
  return [sandbox.name || sandbox.id, sandbox.state, left].filter(Boolean).join(' · ');
};

const matches = (needle: string, ...fields: Array<string | null>): boolean => (
  needle.length === 0 || fields.some((field) => field?.toLowerCase().includes(needle))
);

export const mentionRows = (input: MentionRowsInput): MentionsItem[] => {
  const needle = input.query.trim().toLowerCase();

  const sandboxes = [...input.sandboxes].sort((left, right) => {
    const project = Number(!input.projectIds?.has(left.id)) - Number(!input.projectIds?.has(right.id));
    if (project !== 0) return project;
    const up = Number(!isUpState(left.state)) - Number(!isUpState(right.state));
    if (up !== 0) return up;
    return (left.name || left.id).localeCompare(right.name || right.id);
  });

  const rows: MentionsItem[] = [];
  for (const sandbox of sandboxes) {
    const sessions = [...(input.sessions(sandbox.id) ?? [])].sort(
      (left, right) => Number(right.status === 'busy') - Number(left.status === 'busy')
        || right.updatedAt - left.updatedAt,
    );

    for (const session of sessions) {
      const title = clip(session.title ?? 'New session', MENTION_TEXT_MAX);
      const subtitle = clip(sessionSubtitle(sandbox, session), MENTION_TEXT_MAX);
      if (!matches(needle, title, subtitle, sandbox.id, session.id)) continue;
      rows.push({ id: mentionSessionId(sandbox.id, session.id), title, subtitle });
      if (rows.length >= MENTION_ROW_MAX) return rows;
    }

    const title = 'Sandbox overview';
    const subtitle = clip(sandboxSubtitle(sandbox), MENTION_TEXT_MAX);
    if (!matches(needle, title, subtitle, sandbox.id, sandbox.environment)) continue;
    rows.push({ id: mentionSandboxId(sandbox.id), title, subtitle });
    if (rows.length >= MENTION_ROW_MAX) return rows;
  }

  return rows;
};
