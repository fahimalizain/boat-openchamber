/** The panel's two surfaces and the rule that picks one on open. */
export type PanelTab = 'sandboxes' | 'conversations';

export const DEFAULT_TAB: PanelTab = 'sandboxes';

export const defaultTab = (input: {
  /** A tab the user chose before. */
  stored: PanelTab | null;
  sandboxId: string | null;
  conversations: number;
}): PanelTab => {
  if (input.stored) return input.stored;
  return input.sandboxId && input.conversations > 0 ? 'conversations' : DEFAULT_TAB;
};

export const isPanelTab = (value: string): value is PanelTab => (
  value === 'sandboxes' || value === 'conversations'
);
