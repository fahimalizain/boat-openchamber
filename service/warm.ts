/** What runs after every sandbox refresh: caches warm, instructions follow. */
import { isUpState } from '../shared/types.ts';
import type { ConversationList } from './data/conversation-list.ts';
import type { DesktopLinks } from './data/desktop-links.ts';
import type { PlanNote } from './data/plan-note.ts';
import type { RunningAgents } from './data/running-agents.ts';
import type { SandboxSnapshot } from './data/sandbox-list.ts';
import type { InstructionsWriter } from './instructions.ts';

export type Warmer = (snapshot: SandboxSnapshot) => void;

export const createWarmer = (options: {
  conversations: ConversationList;
  desktop: DesktopLinks;
  agents: RunningAgents;
  planNote: PlanNote;
  instructions: InstructionsWriter;
}): Warmer => (snapshot) => {
  const up = snapshot.sandboxes.filter((sandbox) => isUpState(sandbox.state)).map((sandbox) => sandbox.id);
  options.desktop.warm(up);
  for (const id of up) options.agents.check(id);

  const valid = new Set(snapshot.sandboxes.map((sandbox) => sandbox.id));
  options.desktop.sweep(valid);
  options.agents.sweep(valid);
  options.conversations.sweep(valid);

  options.planNote.refresh();
  void options.instructions.sync(snapshot);
};
