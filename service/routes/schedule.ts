import { readServiceScheduleRequest } from '@openchamber/sdk';

import { route, type Route } from '../router.ts';

export const scheduleRoutes = (options: { onWake: () => void }): Route[] => [
  route('POST', '/schedule', async (context) => {
    if (!readServiceScheduleRequest(await context.body())) return context.reply(400, {});
    options.onWake();
    return context.reply(200, { ok: true });
  }),
];
