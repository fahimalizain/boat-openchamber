/** Keeps the selected conversation honest when the list no longer has it. */
export const CONVERSATION_GRACE_MS = 15_000;

export type ConversationSelection = {
  conversationId: string | null;
  pendingSince: number | null;
};

/**
 * A selected conversation that vanished is cleared, unless it was just
 * started and is still waiting for its first list appearance.
 */
export const settleConversation = (
  selection: ConversationSelection,
  conversationIds: readonly string[],
  now = Date.now(),
  graceMs = CONVERSATION_GRACE_MS,
): ConversationSelection => {
  if (!selection.conversationId) return { conversationId: null, pendingSince: null };
  if (conversationIds.includes(selection.conversationId)) {
    return { conversationId: selection.conversationId, pendingSince: null };
  }
  if (selection.pendingSince !== null && now - selection.pendingSince <= graceMs) {
    return selection;
  }
  return { conversationId: null, pendingSince: null };
};
