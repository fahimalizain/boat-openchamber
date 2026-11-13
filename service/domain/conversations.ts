/** Conversation reads: `boat conversations --json` is one wrapped JSON line each. */
import { isRecord, readNumber, readString } from '../../shared/json.ts';
import type { Conversation } from '../../shared/types.ts';
import { readBoatLine, runBoat } from '../boat.ts';

/** Handles both the CLI's `{ event, data }` envelope and the flat shape. */
export const parseConversationRows = (rows: unknown[]): Conversation[] => rows.flatMap((row) => {
  const line = readBoatLine(row);
  if (!line) return [];
  const value = line.value;
  const id = readString(value.id) ?? readString(value.conversationId);
  if (!id) return [];
  return [{
    id,
    createdAt: readString(value.createdAt),
    lastPromptAt: readString(value.lastPromptAt),
    prompts: readNumber(value.prompts) ?? 0,
    running: value.running === true,
    lastHarness: readString(value.lastHarness) ?? readString(value.harness),
    lastModel: readString(value.lastModel) ?? readString(value.model),
    lastPromptPreview: readString(value.lastPromptPreview) ?? readString(value.lastPrompt),
    current: value.current === true,
  }];
});

/** One parsed JSON line is an object; several become an array. */
export const conversationRows = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    return Array.isArray(data.conversations) ? data.conversations : [data];
  }
  return [];
};

export const listConversations = async (sandboxId: string): Promise<Conversation[]> => {
  const data = await runBoat('conversations', [sandboxId], { timeoutMs: 15_000 });
  return parseConversationRows(conversationRows(data));
};
