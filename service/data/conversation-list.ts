/** Conversations per sandbox, cached for a couple of seconds across routes. */
import type { Conversation } from '../../shared/types.ts';
import { listConversations } from '../domain/conversations.ts';

export type ConversationList = {
  get: (sandboxId: string, options?: { force?: boolean }) => Promise<Conversation[]>;
  peek: (sandboxId: string) => Conversation[] | null;
  forget: (sandboxId: string) => void;
  sweep: (valid: Set<string>) => void;
};

export const createConversationList = (options: { ttlMs: number }): ConversationList => {
  const entries = new Map<string, { at: number; conversations: Conversation[] }>();

  return {
    get: async (sandboxId, readOptions = {}) => {
      const cached = entries.get(sandboxId);
      if (!readOptions.force && cached && Date.now() - cached.at < options.ttlMs) return cached.conversations;
      const conversations = await listConversations(sandboxId);
      entries.set(sandboxId, { at: Date.now(), conversations });
      return conversations;
    },
    peek: (sandboxId) => entries.get(sandboxId)?.conversations ?? null,
    forget: (sandboxId) => {
      entries.delete(sandboxId);
    },
    sweep: (valid) => {
      for (const id of [...entries.keys()]) if (!valid.has(id)) entries.delete(id);
    },
  };
};
