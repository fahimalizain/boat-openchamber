import { readString } from '../../shared/json.ts';
import {
  errorBody,
  type ActionResponse,
  type SandboxesResponse,
} from '../../shared/routes.ts';
import type { Sandbox, SandboxAction, SandboxSummary } from '../../shared/types.ts';
import type { ServiceContext } from '../context.ts';
import { openOpencodeUrl } from '../domain/opencode.ts';
import { describeFailure } from '../failures.ts';
import { route, type Route } from '../router.ts';
import { isSandboxId } from '../validation.ts';

type Deps = Pick<ServiceContext, 'sandboxes' | 'scoper' | 'projects' | 'agents' | 'desktop' | 'perform' | 'refresh' | 'forget'>;

const summaryOf = (sandbox: Sandbox): SandboxSummary => ({
  id: sandbox.id,
  name: sandbox.name,
  state: sandbox.state,
  type: sandbox.type,
  vcpu: sandbox.vcpu,
  memoryGB: sandbox.memoryGB,
  environment: sandbox.environment,
  ttlSeconds: sandbox.ttlSeconds,
  archiveAfter: sandbox.archiveAfter,
  stoppedAt: sandbox.stoppedAt,
  desktopAvailable: sandbox.desktopAvailable,
});

const isLifecycleAction = (action: SandboxAction): action is 'stop' | 'resume' | 'extend' => (
  action === 'stop' || action === 'resume' || action === 'extend'
);

export const sandboxRoutes = (deps: Deps): Route[] => [
  route('GET', '/sandboxes', async (context) => {
    const directory = context.search.get('directory');
    if (directory) deps.projects.remember([directory]);

    const snapshot = await deps.sandboxes.get();
    const scope = await deps.scoper.apply(snapshot.sandboxes, directory);
    const ordered = [...scope.entries].sort(
      (left, right) => Number(right.inProject) - Number(left.inProject),
    );
    const body: SandboxesResponse = {
      sandboxes: ordered.map((entry) => ({
        ...summaryOf(entry.sandbox),
        matchedBy: entry.matchedBy,
        inProject: entry.inProject,
        agentRunning: deps.agents.has(entry.sandbox.id),
      })),
      error: snapshot.failure?.text ?? null,
      now: Date.now(),
      projectScoped: scope.scoped,
    };
    return context.reply(200, body);
  }),

  route('POST', '/action', async (context) => {
    const body = await context.json<Record<string, unknown>>();
    const sandboxId = readString(body?.sandbox);
    const action = readString(body?.action) as SandboxAction | null;
    if (!isSandboxId(sandboxId) || !action) return context.reply(400, errorBody('Unknown sandbox or action.'));

    const snapshot = await deps.sandboxes.get();
    const sandbox = snapshot.sandboxes.find((candidate) => candidate.id === sandboxId);
    if (!sandbox) return context.reply(404, errorBody('That sandbox is not in the list any more.'));

    if (action === 'desktop') {
      try {
        const url = await deps.desktop.get(sandboxId);
        if (!url) return context.reply(502, errorBody('This sandbox has no desktop to open.'));
        const answer: ActionResponse = { ok: true, url };
        return context.reply(200, answer);
      } catch (failure) {
        return context.reply(502, errorBody(describeFailure(failure).text));
      }
    }

    if (action === 'opencode') {
      try {
        const answer: ActionResponse = { ok: true, url: await openOpencodeUrl(sandboxId) };
        return context.reply(200, answer);
      } catch (failure) {
        return context.reply(502, errorBody(describeFailure(failure).text));
      }
    }

    if (!isLifecycleAction(action)) return context.reply(400, errorBody('Unknown sandbox action.'));

    try {
      await deps.perform(action, sandbox);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
    deps.forget(sandboxId);
    await deps.refresh();
    return context.reply(200, { ok: true });
  }),
];
