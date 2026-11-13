/** The text an `@` chip hands the agent: a sandbox summary or an OpenCode session transcript. */
import { clip } from '../../shared/json.ts';
import type { OpencodeMessage, OpencodePart, OpencodeSession, OpencodeTool } from '../../shared/opencode.ts';
import { remaining, timeAgoAt } from '../../shared/time.ts';
import { isUpState, type Sandbox } from '../../shared/types.ts';

export const MENTION_TEXT_MAX = 16_000;
const SESSIONS_SHOWN = 10;
const MESSAGES_SHOWN = 40;
const TOOL_DETAIL_MAX = 120;

const sizeOf = (sandbox: Sandbox): string => {
  const parts = [sandbox.type ?? 'default'];
  if (sandbox.memoryGB !== null) parts.push(`${sandbox.memoryGB} GB`);
  if (sandbox.vcpu !== null) parts.push(`${sandbox.vcpu} vCPU`);
  return parts.join(' · ');
};

const stateOf = (sandbox: Sandbox): string => {
  const left = isUpState(sandbox.state) ? remaining(sandbox.archiveAfter) : '';
  return left ? `${sandbox.state} · ${left}` : sandbox.state;
};

const modelOf = (session: OpencodeSession): string | null => {
  if (!session.model) return null;
  return [session.model.providerID, session.model.id, session.model.variant].filter(Boolean).join('/');
};

const sessionLine = (session: OpencodeSession): string => (
  [
    `- \`${session.id}\`: ${session.title ? `"${clip(session.title, 100)}"` : 'new session'}`,
    session.status,
    session.directory,
    timeAgoAt(session.updatedAt),
  ].filter(Boolean).join(' · ')
);

export const renderSandboxMention = (sandbox: Sandbox, sessions: OpencodeSession[]): string => {
  const lines = [
    `## Sandbox ${sandbox.name} (\`${sandbox.id}\`)`,
    '',
    `- State: ${stateOf(sandbox)}`,
    `- Size: ${sizeOf(sandbox)}`,
    sandbox.environment ? `- Environment: ${sandbox.environment}` : null,
    `- OpenCode sessions: ${sessions.length}`,
    '',
    sessions.length > 0 ? '**Sessions**' : '_No OpenCode sessions yet._',
  ].filter((line): line is string => line !== null);

  for (const session of sessions.slice(0, SESSIONS_SHOWN)) lines.push(sessionLine(session));
  if (sessions.length > SESSIONS_SHOWN) {
    lines.push(`- and ${sessions.length - SESSIONS_SHOWN} more.`);
  }

  lines.push(
    '',
    `Run commands inside it with \`boat exec ${sandbox.id} -- <command>\`.`,
    'Sandbox agents run in this sandbox\'s OpenCode server; open them from the Boat panel\'s Sessions tab (or the row menu\'s OpenCode item).',
  );

  return clip(lines.join('\n'), MENTION_TEXT_MAX);
};

const oneLine = (text: string, max: number): string => clip(text.replace(/\s+/g, ' ').trim(), max);

const toolDetail = (tool: OpencodeTool): string => {
  const input = tool.input ?? {};
  for (const key of ['command', 'description', 'filePath', 'path', 'pattern']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return oneLine(value, TOOL_DETAIL_MAX);
  }
  return '';
};

const toolLine = (tool: OpencodeTool): string => {
  const detail = toolDetail(tool);
  const failed = tool.status === 'error';
  return `- \`${tool.name}\`${detail ? ` — ${detail}` : ''}${failed ? ' (failed)' : ''}`;
};

const textOf = (parts: OpencodePart[]): string => (
  parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('\n').trim()
);

const messageLines = (message: OpencodeMessage): string[] => {
  const lines: string[] = [];
  const text = textOf(message.parts);

  if (message.role === 'user') {
    if (text) lines.push(`**You:** ${text}`, '');
    return lines;
  }

  if (text) lines.push(text, '');
  for (const part of message.parts) {
    if (part.kind === 'tool') lines.push(toolLine(part.tool));
  }
  if (message.notice) lines.push(`- ${oneLine(message.notice, 400)}`);
  if (message.error) lines.push(`> ${oneLine(message.error, 600)}`, '');
  if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
  return lines;
};

export const renderSessionMention = (input: {
  sandbox: Sandbox | null;
  sandboxId: string;
  sessionId: string;
  session: OpencodeSession | null;
  messages: OpencodeMessage[];
}): string => {
  const name = input.sandbox?.name ?? input.sandboxId;
  const lines = [
    `## Sandbox ${name} (\`${input.sandboxId}\`) — OpenCode session \`${input.sessionId}\``,
    '',
  ];

  if (input.sandbox) {
    lines.push(`- State: ${stateOf(input.sandbox)}`, `- Size: ${sizeOf(input.sandbox)}`);
  }
  if (input.session) {
    lines.push(`- Title: ${input.session.title ?? 'New session'}`);
    const directory = input.session.directory;
    if (directory) lines.push(`- Directory: \`${directory}\``);
    const agent = [input.session.agent, modelOf(input.session)].filter(Boolean).join(' · ');
    if (agent) lines.push(`- Agent: ${agent}`);
    lines.push(`- Status: ${input.session.status}`);
  }
  lines.push(
    `- Commands: \`boat exec ${input.sandboxId} -- <command>\``,
    '',
    '**Transcript** (oldest first)',
    '',
  );

  const header = lines.join('\n');
  const shown = input.messages.slice(-MESSAGES_SHOWN);
  const omitted = input.messages.length - shown.length;
  const body: string[] = [];
  if (omitted > 0) body.push(`_${omitted} older messages were left out._`, '');
  for (const message of shown) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    body.push(...messageLines(message));
  }

  if (body.length === 0) return clip(`${header}_No messages yet._`, MENTION_TEXT_MAX);
  return clip(`${header}${body.join('\n')}`, MENTION_TEXT_MAX);
};
