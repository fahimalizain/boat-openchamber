/**
 * Agent event reads and normalisation. The CLI and API payloads are
 * extensible, so unknown types keep their text instead of disappearing.
 */
import { clip, isRecord, readString } from '../../shared/json.ts';
import type { UiEvent, UiTool } from '../../shared/types.ts';
import { readBoatLine, runBoat } from '../boat.ts';

const TEXT_MAX = 20_000;
const TOOL_DETAIL_MAX = 300;
const TOOLS_MAX = 40;

const readTimestamp = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const toolDetail = (input: unknown): string => {
  if (input === undefined || input === null) return '';
  if (isRecord(input)) {
    const command = readString(input.command) ?? readString(input.cmd);
    if (command) return clip(command, TOOL_DETAIL_MAX);
    const path = readString(input.path) ?? readString(input.file_path) ?? readString(input.filePath);
    if (path) return clip(path, TOOL_DETAIL_MAX);
  }
  try {
    return clip(JSON.stringify(input), TOOL_DETAIL_MAX);
  } catch {
    return '';
  }
};

const readTools = (value: unknown): UiTool[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, TOOLS_MAX).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const use = isRecord(entry.use) ? entry.use : null;
    const result = isRecord(entry.result) ? entry.result : null;
    return [{
      name: readString(use?.name) ?? readString(use?.type) ?? 'tool',
      detail: toolDetail(use?.input),
      isError: result?.is_error === true,
    }];
  });
};

export const normalizeEvent = (raw: unknown, fallbackConversation: string | null = null): UiEvent | null => {
  const line = readBoatLine(raw);
  if (!line) return null;
  const value = line.value;

  const id = readString(value.id) ?? readString(value.eventId);
  if (!id) return null;

  const type = readString(value.type) ?? readString(value.event) ?? 'event';
  const data = isRecord(value.data) ? value.data : {};
  const base = {
    id,
    type,
    at: readTimestamp(value.timestamp) || Date.now(),
    text: '',
    streaming: false,
    model: null as string | null,
    status: null as string | null,
    tools: [] as UiTool[],
    error: null as string | null,
    conversationId: readString(value.conversationId) ?? readString(data.conversationId) ?? fallbackConversation,
  };

  if (type === 'prompt') {
    const status = readString(data.status);
    const failed = status === 'failed' || status === 'error';
    return {
      ...base,
      role: 'user',
      text: clip(readString(data.prompt) ?? readString(data.message) ?? '', TEXT_MAX),
      status,
      error: failed ? readString(data.error) ?? readString(data.message) ?? 'The turn failed.' : null,
    };
  }

  if (type === 'response') {
    return {
      ...base,
      role: 'assistant',
      text: clip(readString(data.content) ?? '', TEXT_MAX),
      streaming: data.is_streaming === true || line.final === false,
      model: readString(data.model),
      tools: readTools(data.tools),
      error: readString(data.error),
    };
  }

  if (type === 'steer') {
    return {
      ...base,
      role: 'user',
      text: clip(readString(data.message) ?? readString(data.prompt) ?? readString(data.content) ?? '', TEXT_MAX),
      status: readString(data.mode) ?? 'steer',
    };
  }

  if (type === 'error' || type === 'sandbox.error') {
    const message = readString(data.message) ?? readString(data.error) ?? readString(value.error) ?? 'The agent failed.';
    return { ...base, role: 'system', text: clip(message, TEXT_MAX), error: message };
  }

  const text = readString(data.content) ?? readString(data.message) ?? '';
  return {
    ...base,
    role: text ? 'assistant' : 'system',
    text: clip(text, TEXT_MAX),
    error: readString(data.error),
  };
};

/** Parse and upsert by id, so a streamed partial and its final collapse into one. */
export const mergeEventRows = (rows: unknown[], conversationId: string): UiEvent[] => {
  const byId = new Map<string, UiEvent>();
  for (const row of rows) {
    const event = normalizeEvent(row, conversationId);
    if (event) byId.set(event.id, event);
  }
  return [...byId.values()];
};

/** One parsed JSON line is an object; several become an array. */
export const eventRows = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    return Array.isArray(data.events) ? data.events : [data];
  }
  return [];
};

export const listEvents = async (
  sandboxId: string,
  conversationId: string,
  options: { timeoutMs?: number } = {},
): Promise<UiEvent[]> => {
  const data = await runBoat('events', [sandboxId, '--convo', conversationId], {
    timeoutMs: options.timeoutMs ?? 30_000,
  });
  return mergeEventRows(eventRows(data), conversationId);
};

/** Rough serialized size, for keeping a batched emit under the host's cap. */
export const eventSize = (event: UiEvent): number => (
  200
  + event.text.length
  + event.tools.reduce((total, tool) => total + tool.name.length + tool.detail.length + 32, 0)
);
