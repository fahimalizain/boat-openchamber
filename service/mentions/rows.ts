/** One row per cached conversation and one per sandbox; pure and quick for the 2 s menu. */
import type { MentionsItem } from '@openchamber/sdk';

import { clip } from '../../shared/json.ts';
import { remaining, timeAgo } from '../../shared/time.ts';
import { isUpState, type Conversation, type Sandbox } from '../../shared/types.ts';
import { isConversationId, isSandboxId } from '../validation.ts';

export const MENTION_ROW_MAX = 20;
export const MENTION_TEXT_MAX = 120;

export type MentionRowsInput = {
  sandboxes: Sandbox[];
  conversations: (sandboxId: string) => Conversation[] | null;
  /** Sandbox ids in the request's project, when it named one and we have ranked it. */
  projectIds: ReadonlySet<string> | null;
  query: string;
};

export const mentionSandboxId = (sandboxId: string): string => `sandbox:${sandboxId}`;

export const mentionConversationId = (sandboxId: string, conversationId: string): string => (
  `conversation:${sandboxId}:${conversationId}`
);

export type ParsedMention =
  | { kind: 'sandbox'; sandboxId: string }
  | { kind: 'conversation'; sandboxId: string; conversationId: string };

export const parseMentionId = (id: string | null): ParsedMention | null => {
  if (!id) return null;
  const [kind, sandboxId, conversationId] = id.split(':');
  if (!isSandboxId(sandboxId)) return null;
  if (kind === 'sandbox') return { kind, sandboxId };
  if (kind === 'conversation' && isConversationId(conversationId)) {
    return { kind, sandboxId, conversationId };
  }
  return null;
};

const conversationSubtitle = (sandbox: Sandbox, conversation: Conversation): string => {
  const harness = conversation.lastHarness ?? 'agent';
  const model = conversation.lastModel ? `/${conversation.lastModel}` : '';
  return [
    sandbox.name || sandbox.id,
    `${harness}${model}`,
    conversation.running ? 'running' : 'idle',
    timeAgo(conversation.lastPromptAt),
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
    const conversations = [...(input.conversations(sandbox.id) ?? [])].sort(
      (left, right) => Number(right.running) - Number(left.running)
        || (Date.parse(right.lastPromptAt ?? '') || 0) - (Date.parse(left.lastPromptAt ?? '') || 0),
    );

    for (const conversation of conversations) {
      const title = clip(conversation.lastPromptPreview ?? 'New conversation', MENTION_TEXT_MAX);
      const subtitle = clip(conversationSubtitle(sandbox, conversation), MENTION_TEXT_MAX);
      if (!matches(needle, title, subtitle, sandbox.id, conversation.id)) continue;
      rows.push({ id: mentionConversationId(sandbox.id, conversation.id), title, subtitle });
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
