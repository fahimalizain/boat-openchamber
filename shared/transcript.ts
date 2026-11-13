/**
 * One reading of agent events for the panel and the mention text: who spoke,
 * which tools ran, what failed. Rendering stays with each consumer.
 */
import { stamp } from './time.ts';
import type { UiEvent, UiTool } from './types.ts';

export type TranscriptEntry = {
  id: string;
  at: number;
  role: UiEvent['role'];
  speaker: string;
  status: string | null;
  streaming: boolean;
  failed: boolean;
  text: string;
  tools: UiTool[];
  error: string | null;
};

const speakerOf = (event: UiEvent): string => {
  if (event.type === 'steer') return 'steer';
  if (event.role === 'user') return 'you';
  if (event.role === 'assistant') return event.model ?? 'agent';
  return event.type || 'event';
};

export const transcriptEntries = (events: Iterable<UiEvent>): TranscriptEntry[] => (
  [...events]
    .map((event): TranscriptEntry => ({
      id: event.id,
      at: event.at,
      role: event.role,
      speaker: speakerOf(event),
      status: event.status,
      streaming: event.streaming,
      failed: Boolean(event.error) || event.status === 'failed' || event.status === 'error',
      text: event.text,
      tools: event.tools,
      error: event.error,
    }))
    .sort((left, right) => left.at - right.at || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
);

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const entryMarkdown = (entry: TranscriptEntry): string => {
  const tags = [
    entry.failed ? 'failed' : null,
    entry.status && entry.status !== 'running' ? entry.status : null,
    entry.streaming ? 'streaming' : null,
  ].filter(Boolean);
  const when = stamp(entry.at);
  const heading = `**${entry.speaker === 'you' ? 'You' : entry.speaker}**${when ? ` · ${when}` : ''}${tags.length > 0 ? ` · ${tags.join(', ')}` : ''}`;
  const lines = [heading];

  for (const tool of entry.tools) {
    const detail = oneLine(tool.detail);
    lines.push(`- \`${tool.name}\`${detail ? ` ${detail}` : ''}${tool.isError ? ' (error)' : ''}`);
  }

  if (entry.text.trim()) lines.push('', entry.text.trim());
  if (entry.error) lines.push('', `**Error:** ${entry.error}`);
  return lines.join('\n');
};

/**
 * Markdown for the newest entries that fit, oldest first. When older turns do
 * not fit, the answer starts with a note saying so.
 */
export const markdownTranscript = (entries: TranscriptEntry[], limit: number): { text: string; truncated: boolean } => {
  if (entries.length === 0) return { text: '', truncated: false };

  const blocks = entries.map(entryMarkdown);
  let text = '';
  let kept = 0;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index] ?? '';
    const separator = text ? 2 : 0;
    if (text.length + block.length + separator > limit) break;
    text = text ? `${block}\n\n${text}` : block;
    kept += 1;
  }

  if (kept === blocks.length) return { text, truncated: false };

  const note = '_Older turns were left out to keep this transcript short._';
  if (kept === 0) {
    // A single event larger than the budget: cut it rather than answer nothing.
    const newest = blocks[blocks.length - 1] ?? '';
    const room = Math.max(0, limit - note.length - 2);
    return { text: `${note}\n\n${newest.slice(0, room)}\n\n_…_`, truncated: true };
  }

  return { text: `${note}\n\n${text}`, truncated: true };
};
