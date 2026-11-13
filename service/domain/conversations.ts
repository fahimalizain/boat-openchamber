/** Conversation reads: `boat conversations --json` is JSONL, one conversation per line. */
import { isRecord, readNumber, readString } from '../../shared/json.ts';
import type { Conversation } from '../../shared/types.ts';
import { runBoat } from '../boat.ts';

export const listConversations = async (sandboxId: string): Promise<Conversation[]> => {
  const data = await runBoat('conversations', [sandboxId], { timeoutMs: 15_000 });
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.conversations)
      ? data.conversations
      : [];
  return rows.filter(isRecord).flatMap((row) => {
    const id = readString(row.id) ?? readString(row.conversationId);
    if (!id) return [];
    return [{
      id,
      createdAt: readString(row.createdAt),
      lastPromptAt: readString(row.lastPromptAt),
      prompts: readNumber(row.prompts) ?? 0,
      running: row.running === true,
      lastHarness: readString(row.lastHarness) ?? readString(row.harness),
      lastModel: readString(row.lastModel) ?? readString(row.model),
      lastPromptPreview: readString(row.lastPromptPreview) ?? readString(row.lastPrompt),
      current: row.current === true,
    }];
  });
};
