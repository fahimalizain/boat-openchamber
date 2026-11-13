import type { ServiceContext } from '../context.ts';
import { describeFailure } from '../failures.ts';
import { route, type Route } from '../router.ts';
import { readStatusAction } from '../status/actions.ts';

type Deps = Pick<ServiceContext, 'sandboxes' | 'projects' | 'statusView' | 'perform' | 'refresh' | 'forget'>;

export const statusRoutes = (deps: Deps): Route[] => [
  route('GET', '/status', async (context) => {
    const directory = context.search.get('directory');
    if (directory) deps.projects.remember([directory]);

    try {
      return context.reply(200, await deps.statusView(directory));
    } catch (failure) {
      // A section never shows an error page; it says what went wrong in a row.
      return context.reply(200, {
        rows: [{ kind: 'note', id: 'note-error', text: describeFailure(failure).text, tone: 'error' }],
      });
    }
  }),

  route('POST', '/status', async (context) => {
    const snapshot = await deps.sandboxes.get();
    const action = readStatusAction(await context.body(), snapshot.sandboxes);
    if (!action) return context.reply(422, { message: 'That control is no longer recognised. Reopen the section.' });

    const sandbox = snapshot.sandboxes.find((candidate) => candidate.id === action.sandboxId);
    if (!sandbox) return context.reply(422, { message: 'That sandbox is not in the list any more.' });

    try {
      await deps.perform(action.verb, sandbox);
    } catch (failure) {
      return context.reply(502, { message: describeFailure(failure).text });
    }
    deps.forget(action.sandboxId);
    await deps.refresh();
    return context.reply(200, {});
  }),
];
