/** The create form's options and the one create route. */
import { isAbsolute } from 'node:path';

import {
  errorBody,
  type CreateOptionsResponse,
  type CreateSandboxRequest,
  type CreateSandboxResponse,
} from '../../shared/routes.ts';
import type { ServiceContext } from '../context.ts';
import { readLimits } from '../domain/limits.ts';
import { chooseEnvironment, folderNameOf } from '../project/matcher.ts';
import { listSavedSnapshots } from '../domain/snapshots.ts';
import { describeFailure } from '../failures.ts';
import {
  limitsBlockedReason,
  readCreateRequest,
} from '../create/request.ts';
import { route, type Route } from '../router.ts';

type Deps = Pick<ServiceContext, 'environments' | 'remotes' | 'createJobs'>;

export const createRoutes = (deps: Deps): Route[] => [
  route('GET', '/create-options', async (context) => {
    const directory = context.search.get('directory');

    try {
      const [environments, limits, snapshots] = await Promise.all([
        deps.environments.get().catch(() => []),
        readLimits(),
        listSavedSnapshots().catch(() => []),
      ]);

      let suggested = environments.find((environment) => environment.isDefault)?.name ?? null;
      if (directory && isAbsolute(directory)) {
        const repoSlugs = await deps.remotes.get(directory).catch(() => []);
        suggested = chooseEnvironment(environments, { folderName: folderNameOf(directory), repoSlugs }) ?? suggested;
      }

      const body: CreateOptionsResponse = {
        environments: environments.map((environment) => ({
          name: environment.name,
          isDefault: environment.isDefault,
        })),
        snapshots,
        limits: {
          canStart: limits.canStart,
          reason: limitsBlockedReason(limits),
          active: limits.active,
          maxActive: limits.maxActive,
          autoStopMaxHours: limits.autoStopMaxHours,
          sizes: limits.sizes,
        },
        suggestedEnvironment: suggested,
      };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),

  route('POST', '/create', async (context) => {
    const body = await context.json<CreateSandboxRequest>();
    if (deps.createJobs.busy()) {
      return context.reply(409, errorBody('A sandbox is already being created.'));
    }

    let limits;
    try {
      limits = await readLimits();
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }

    const blocked = limitsBlockedReason(limits);
    if (blocked) return context.reply(409, errorBody(blocked));

    const request = readCreateRequest(body, limits.autoStopMaxHours);
    if (!request.ok) return context.reply(400, errorBody(request.error));

    if (request.input.size) {
      const size = limits.sizes.find((entry) => entry.id === request.input.size);
      if (size && !size.available) {
        return context.reply(409, errorBody(size.reason ?? 'That machine size is not available on this plan.'));
      }
    }

    try {
      deps.createJobs.start(request.input);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }

    const answer: CreateSandboxResponse = { accepted: true };
    return context.reply(200, answer);
  }),
];
