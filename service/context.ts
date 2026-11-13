/** The composition root: builds the caches, scoper, followers and route-facing reads. */
import type { GuestStatusView, ServiceMark } from '@openchamber/sdk';

import type { Sandbox, SandboxActionVerb } from '../shared/types.ts';
import { createCreateJobs, type CreateJobs } from './create/jobs.ts';
import { createEnvironmentList, type EnvironmentList } from './data/environment-list.ts';
import { createDesktopLinks, type DesktopLinks } from './data/desktop-links.ts';
import { createPlanNote, type PlanNote } from './data/plan-note.ts';
import { createProjectRegistry, type ProjectRegistry } from './data/project-registry.ts';
import { createSandboxList, type SandboxList, type SandboxSnapshot } from './data/sandbox-list.ts';
import { listEnvironments } from './domain/environments.ts';
import { listSandboxes, renameSandbox, spawnCreate } from './domain/sandboxes.ts';
import { createInstructionsWriter } from './instructions.ts';
import { createMarker, type Marker } from './marks/marker.ts';
import { createOpencodeConnections, type OpencodeConnections } from './opencode/connection.ts';
import { createOpencodeFollowers, type OpencodeFollowers } from './opencode/followers.ts';
import { createOpencodeSessions, type OpencodeSessions } from './opencode/sessions.ts';
import { createProjectRanking, type ProjectRanking } from './project/ranking.ts';
import { createRemoteCache, type RemoteCache } from './project/remotes.ts';
import { createScoper, type Scoper } from './project/scope.ts';
import { performSandboxAction } from './status/actions.ts';
import { buildProjectInstructions } from './status/text.ts';
import { buildStatusView } from './status/view.ts';
import { createWarmer } from './warm.ts';

export type ServiceHost = {
  setInstructions: (directory: string | null, text: string) => Promise<unknown>;
  emit: (topic: string, data: unknown) => Promise<unknown>;
  setMark: (target: { directory: string }, mark: ServiceMark | null) => Promise<unknown>;
};

export type ServiceContext = {
  sandboxes: SandboxList;
  desktop: DesktopLinks;
  /** A sandbox's OpenCode sessions, cached, plus the busy set the badge reads. */
  sessions: OpencodeSessions;
  /** The sandbox OpenCode servers the panel talks to. */
  opencode: OpencodeConnections;
  opencodeFollowers: OpencodeFollowers;
  scoper: Scoper;
  ranking: ProjectRanking;
  environments: EnvironmentList;
  remotes: RemoteCache;
  projects: ProjectRegistry;
  createJobs: CreateJobs;
  statusView: (directory: string | null) => Promise<GuestStatusView>;
  refresh: () => Promise<SandboxSnapshot>;
  forget: (sandboxId: string) => void;
  perform: (verb: SandboxActionVerb, sandbox: Sandbox) => Promise<void>;
};

const TTL = {
  sandboxes: 4_000,
  sessions: 3_000,
  sessionCheck: 20_000,
  desktop: 5 * 60_000,
  environments: 60_000,
  remotes: 5 * 60_000,
  limits: 5 * 60_000,
  instructionsRetry: 30_000,
} as const;

const FOLLOWERS = { ttlMs: 120_000, sweepMs: 30_000, flushMs: 250 } as const;

export const createServiceContext = (host: ServiceHost): ServiceContext => {
  const desktop = createDesktopLinks({ ttlMs: TTL.desktop });
  const planNote = createPlanNote({ ttlMs: TTL.limits });
  const instructions = createInstructionsWriter({
    setInstructions: host.setInstructions,
    retryMs: TTL.instructionsRetry,
  });

  const environments = createEnvironmentList({ ttlMs: TTL.environments, load: listEnvironments });
  const remotes = createRemoteCache({ ttlMs: TTL.remotes });
  const ranking = createProjectRanking();
  const scoper = createScoper({ environments, remotes, ranking });
  const projects = createProjectRegistry({
    file: process.env.BOAT_PROJECTS_FILE?.trim() || undefined,
  });
  const opencode = createOpencodeConnections();
  const sessions = createOpencodeSessions({
    connections: opencode,
    ttlMs: TTL.sessions,
    checkMs: TTL.sessionCheck,
  });
  const marker: Marker = createMarker({ projects, scoper, sessions, setMark: host.setMark });

  const sandboxes = createSandboxList({
    ttlMs: TTL.sandboxes,
    load: listSandboxes,
    onSnapshot: createWarmer({ sessions, desktop, planNote, instructions, marker }),
  });
  const opencodeFollowers = createOpencodeFollowers({
    connections: opencode,
    sink: host.emit,
    ...FOLLOWERS,
  });

  const forgetSandbox = (sandboxId: string): void => {
    sessions.forget(sandboxId);
    desktop.forget(sandboxId);
    opencode.forget(sandboxId);
    opencodeFollowers.unwatch(sandboxId);
  };

  const createJobs = createCreateJobs({
    spawn: spawnCreate,
    rename: renameSandbox,
    emit: (progress) => {
      void host.emit('boat:create', progress).catch(() => {});
    },
    onCreated: (sandboxId) => {
      forgetSandbox(sandboxId);
      void sandboxes.get(true).catch(() => {});
    },
    onReady: (sandboxId) => {
      forgetSandbox(sandboxId);
      void sandboxes.get(true).catch(() => {});
    },
  });

  return {
    sandboxes,
    desktop,
    sessions,
    opencode,
    opencodeFollowers,
    scoper,
    ranking,
    environments,
    remotes,
    projects,
    createJobs,
    statusView: async (directory) => {
      const snapshot = await sandboxes.get();
      const scope = await scoper.apply(snapshot.sandboxes, directory);
      const visible = scope.scoped ? scope.entries.filter((entry) => entry.inProject) : scope.entries;

      if (scope.scoped && directory && scope.folderName) {
        void instructions.syncProject(
          directory,
          buildProjectInstructions(scope.folderName, visible.map((entry) => entry.sandbox), Date.now()),
        );
      }

      return buildStatusView({
        sandboxes: visible.map((entry) => entry.sandbox),
        desktopUrls: desktop.all(),
        busy: sessions.busyAll(),
        failure: snapshot.failure,
        planNote: planNote.current(),
        now: Date.now(),
        scoped: scope.scoped,
        others: scope.others,
      });
    },
    refresh: () => sandboxes.get(true),
    forget: forgetSandbox,
    perform: performSandboxAction,
  };
};
