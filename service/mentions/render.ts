/** The text an `@` chip hands the agent: a sandbox summary or a conversation transcript. */
import { clip } from '../../shared/json.ts';
import { remaining, timeAgo } from '../../shared/time.ts';
import { markdownTranscript, transcriptEntries } from '../../shared/transcript.ts';
import { isUpState, type Conversation, type Sandbox, type UiEvent } from '../../shared/types.ts';

export const MENTION_TEXT_MAX = 16_000;
const CONVERSATIONS_SHOWN = 10;

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

const harnessOf = (conversation: Conversation | null): string | null => {
  if (!conversation) return null;
  const harness = conversation.lastHarness ?? 'agent';
  const model = conversation.lastModel ? `/${conversation.lastModel}` : '';
  const prompts = `${conversation.prompts} prompt${conversation.prompts === 1 ? '' : 's'}`;
  return [
    `${harness}${model}`,
    prompts,
    conversation.running ? 'running' : 'idle',
    timeAgo(conversation.lastPromptAt),
  ].filter(Boolean).join(' · ');
};

export const renderSandboxMention = (sandbox: Sandbox, conversations: Conversation[]): string => {
  const lines = [
    `## Sandbox ${sandbox.name} (\`${sandbox.id}\`)`,
    '',
    `- State: ${stateOf(sandbox)}`,
    `- Size: ${sizeOf(sandbox)}`,
    sandbox.environment ? `- Environment: ${sandbox.environment}` : null,
    `- Conversations: ${conversations.length}`,
    '',
    conversations.length > 0 ? '**Conversations**' : '_No conversations yet._',
  ].filter((line): line is string => line !== null);

  for (const conversation of conversations.slice(0, CONVERSATIONS_SHOWN)) {
    const agent = harnessOf(conversation) ?? 'agent';
    const preview = conversation.lastPromptPreview ? ` — "${clip(conversation.lastPromptPreview, 100)}"` : '';
    lines.push(`- \`${conversation.id}\`: ${agent}${preview}`);
  }
  if (conversations.length > CONVERSATIONS_SHOWN) {
    lines.push(`- and ${conversations.length - CONVERSATIONS_SHOWN} more.`);
  }

  lines.push(
    '',
    `Run commands inside it with \`boat exec ${sandbox.id} -- <command>\`. Start a new conversation with \`boat prompt ${sandbox.id} --new "<text>"\`, or continue one with \`--resume <conversation>\`.`,
  );

  return clip(lines.join('\n'), MENTION_TEXT_MAX);
};

export const renderConversationMention = (input: {
  sandbox: Sandbox | null;
  sandboxId: string;
  conversationId: string;
  conversation: Conversation | null;
  events: UiEvent[];
}): string => {
  const name = input.sandbox?.name ?? input.sandboxId;
  const lines = [
    `## Sandbox ${name} (\`${input.sandboxId}\`) — conversation \`${input.conversationId}\``,
    '',
  ];

  if (input.sandbox) {
    lines.push(`- State: ${stateOf(input.sandbox)}`, `- Size: ${sizeOf(input.sandbox)}`);
  }
  const agent = harnessOf(input.conversation);
  if (agent) lines.push(`- Agent: ${agent}`);
  lines.push(
    `- Continue: \`boat prompt ${input.sandboxId} --resume ${input.conversationId} "<text>"\``,
    `- Commands: \`boat exec ${input.sandboxId} -- <command>\``,
    '',
    '**Transcript** (oldest first)',
    '',
  );

  const header = lines.join('\n');
  const entries = transcriptEntries(input.events);
  if (entries.length === 0) return clip(`${header}_No events yet._`, MENTION_TEXT_MAX);

  const { text } = markdownTranscript(entries, Math.max(400, MENTION_TEXT_MAX - header.length - 2));
  return clip(`${header}${text}`, MENTION_TEXT_MAX);
};
