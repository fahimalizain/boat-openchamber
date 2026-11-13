/** The composition root: builds the caches, followers and route-facing reads. */
import type { GuestStatusView } from '@openchamber/sdk';

import type { Sandbox, SandboxActionVerb } from '../shared/types.ts';
import { createConversationList, type ConversationList } from './data/conversation-list.ts';
import { createDesktopLinks, type DesktopLinks } from './data/desktop-links.ts';
import { createPlanNote, type PlanNote } from './data/plan-note.ts';
import { createRunningAgents, type RunningAgents } from './data/running-agents.ts';
import { createSandboxList, type SandboxList, type SandboxSnapshot } from './data/sandbox-list.ts';
import { listSandboxes } from './domain/sandboxes.ts';
import { createFollowers, type EventSink, type Followers } from './followers.ts';
import { createInstructionsWriter } from './instructions.ts';
import { performSandboxAction } from './status/actions.ts';
import { buildStatusView } from './status/view.ts';
import { createWarmer } from './warm.ts';

export type ServiceHost = {
  setInstructions: (directory: string | null, text: string) => Promise<unknown>;
  emit: EventSink;
};

export type ServiceContext = {
  sandboxes: SandboxList;
  conversations: ConversationList;
  desktop: DesktopLinks;
  agents: RunningAgents;
  followers: Followers;
  statusView: () => Promise<GuestStatusView>;
  refresh: () => Promise<SandboxSnapshot>;
  forget: (sandboxId: string) => void;
  perform: (verb: SandboxActionVerb, sandbox: Sandbox) => Promise<void>;
};

const TTL = {
  sandboxes: 4_000,
  conversations: 2_000,
  desktop: 5 * 60_000,
  agents: 20_000,
  limits: 5 * 60_000,
  instructionsRetry: 30_000,
} as const;

const FOLLOWERS = { ttlMs: 120_000, sweepMs: 30_000, flushMs: 250 } as const;

export const createServiceContext = (host: ServiceHost): ServiceContext => {
  const conversations = createConversationList({ ttlMs: TTL.conversations });
  const desktop = createDesktopLinks({ ttlMs: TTL.desktop });
  const agents = createRunningAgents({ ttlMs: TTL.agents, conversations });
  const planNote = createPlanNote({ ttlMs: TTL.limits });
  const instructions = createInstructionsWriter({
    setInstructions: host.setInstructions,
    retryMs: TTL.instructionsRetry,
  });
  const sandboxes = createSandboxList({
    ttlMs: TTL.sandboxes,
    load: listSandboxes,
    onSnapshot: createWarmer({ conversations, desktop, agents, planNote, instructions }),
  });
  const followers = createFollowers({ sink: host.emit, ...FOLLOWERS });

  return {
    sandboxes,
    conversations,
    desktop,
    agents,
    followers,
    statusView: async () => {
      const snapshot = await sandboxes.get();
      return buildStatusView({
        sandboxes: snapshot.sandboxes,
        desktopUrls: desktop.all(),
        agents: agents.all(),
        failure: snapshot.failure,
        planNote: planNote.current(),
        now: Date.now(),
      });
    },
    refresh: () => sandboxes.get(true),
    forget: (sandboxId) => {
      conversations.forget(sandboxId);
      agents.forget(sandboxId);
      desktop.forget(sandboxId);
    },
    perform: performSandboxAction,
  };
};
