/** The panel's two surfaces and the rule that picks one on open. */
export type PanelTab = 'sandboxes' | 'sessions';

export const DEFAULT_TAB: PanelTab = 'sandboxes';

export const defaultTab = (input: {
  /** A tab the user chose before. */
  stored: PanelTab | null;
  sandboxId: string | null;
  sessions: number;
}): PanelTab => {
  if (input.stored) return input.stored;
  return input.sandboxId && input.sessions > 0 ? 'sessions' : DEFAULT_TAB;
};

export const isPanelTab = (value: string): value is PanelTab => (
  value === 'sandboxes' || value === 'sessions'
);
