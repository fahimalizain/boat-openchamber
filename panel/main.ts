/** Bootstrap: connect to OpenChamber, paint the theme and device, hand over. */
import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';

import { startApp, type App } from './app.ts';
import { applyDevice } from './device.ts';

const host = connectHost();
let app: App | null = null;

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  applyDevice(context.device, document.documentElement);
  if (app) {
    app.setDirectory(context.directory);
    return;
  }

  try {
    app = startApp(host, context);
  } catch (failure) {
    const root = document.getElementById('root');
    if (root) {
      root.textContent = `Boat could not start: ${failure instanceof Error ? failure.message : String(failure)}`;
    }
  }
});
