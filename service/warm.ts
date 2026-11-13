/** What runs after every sandbox refresh: caches warm, instructions follow. */
import { isUpState } from '../shared/types.ts';
import type { DesktopLinks } from './data/desktop-links.ts';
import type { PlanNote } from './data/plan-note.ts';
import type { SandboxSnapshot } from './data/sandbox-list.ts';
import type { InstructionsWriter } from './instructions.ts';
import type { Marker } from './marks/marker.ts';
import type { OpencodeSessions } from './opencode/sessions.ts';

export type Warmer = (snapshot: SandboxSnapshot) => void;

export const createWarmer = (options: {
  sessions: OpencodeSessions;
  desktop: DesktopLinks;
  planNote: PlanNote;
  instructions: InstructionsWriter;
  marker: Marker;
}): Warmer => (snapshot) => {
  const up = snapshot.sandboxes.filter((sandbox) => isUpState(sandbox.state)).map((sandbox) => sandbox.id);
  options.desktop.warm(up);
  // Only sandboxes with an established OpenCode connection are checked; the
  // badge stays off where the server was never started instead of starting it.
  for (const id of up) options.sessions.check(id);

  const valid = new Set(snapshot.sandboxes.map((sandbox) => sandbox.id));
  options.desktop.sweep(valid);
  options.sessions.sweep(valid);

  options.planNote.refresh();
  options.marker.sync(snapshot);
  void options.instructions.sync(snapshot);
};
