/** Which actions a sandbox row shows, from its state alone. */
import { isBootingState, isStoppedState, isUpState } from '../shared/types.ts';

export type SandboxRowAction = 'stop' | 'resume' | 'extend' | 'desktop' | 'copy';

export type SandboxRowActions = {
  /** The one state-changing button on the row. */
  primary: 'stop' | 'resume' | null;
  /** The overflow menu: secondary commands only. */
  menu: Array<'extend' | 'desktop' | 'copy'>;
};

export const rowActionsFor = (state: string, desktopAvailable: boolean): SandboxRowActions => {
  if (isStoppedState(state)) return { primary: 'resume', menu: ['copy'] };

  if (isUpState(state)) {
    return {
      primary: 'stop',
      menu: ['extend', ...(desktopAvailable ? ['desktop' as const] : []), 'copy'],
    };
  }

  // Starting up can only be cancelled; the others have no lifecycle action.
  if (isBootingState(state)) return { primary: 'stop', menu: [] };
  return { primary: null, menu: ['copy'] };
};
