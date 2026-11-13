/**
 * Which sandboxes have an agent working right now. It re-reads the conversation
 * list on a slow clock, and also fills the conversation cache the panel reads.
 */
import type { ConversationList } from './conversation-list.ts';

export type RunningAgents = {
  check: (sandboxId: string) => void;
  has: (sandboxId: string) => boolean;
  all: () => ReadonlySet<string>;
  forget: (sandboxId: string) => void;
  sweep: (valid: Set<string>) => void;
};

export const createRunningAgents = (options: {
  ttlMs: number;
  conversations: ConversationList;
}): RunningAgents => {
  const running = new Set<string>();
  const checkedAt = new Map<string, number>();

  return {
    check: (sandboxId) => {
      const now = Date.now();
      if (now - (checkedAt.get(sandboxId) ?? 0) < options.ttlMs) return;
      checkedAt.set(sandboxId, now);
      void options.conversations.get(sandboxId, { force: true }).then((conversations) => {
        if (conversations.some((conversation) => conversation.running)) running.add(sandboxId);
        else running.delete(sandboxId);
      }, () => {
        // An unreadable conversation list only hides the badge.
      });
    },
    has: (sandboxId) => running.has(sandboxId),
    all: () => running,
    forget: (sandboxId) => {
      running.delete(sandboxId);
      checkedAt.delete(sandboxId);
    },
    sweep: (valid) => {
      for (const id of [...running]) if (!valid.has(id)) running.delete(id);
      for (const id of [...checkedAt.keys()]) if (!valid.has(id)) checkedAt.delete(id);
    },
  };
};
