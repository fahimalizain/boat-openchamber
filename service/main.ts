/** Wires OpenChamber to the service: auth, health, the router, and shutdown. */
import http from 'node:http';

import { createServiceHost, type JsonValue } from '@openchamber/sdk';

import { createServiceContext } from './context.ts';
import { installFollowerCleanup } from './followers.ts';
import { createRequestContext, sendReply } from './http.ts';
import { agentRoutes } from './routes/agent.ts';
import { agentCatalogRoutes } from './routes/agents.ts';
import { conversationRoutes } from './routes/conversations.ts';
import { createRoutes } from './routes/create.ts';
import { eventRoutes } from './routes/events.ts';
import { mentionRoutes } from './routes/mentions.ts';
import { opencodeCatalogRoutes } from './routes/opencode-catalog.ts';
import { opencodeChatRoutes } from './routes/opencode-chat.ts';
import { opencodeEventRoutes } from './routes/opencode-events.ts';
import { opencodeSessionRoutes } from './routes/opencode-sessions.ts';
import { projectRoutes } from './routes/projects.ts';
import { sandboxRoutes } from './routes/sandboxes.ts';
import { scheduleRoutes } from './routes/schedule.ts';
import { statusRoutes } from './routes/status.ts';
import { createRouter } from './router.ts';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN;

if (!token) {
  console.error('Boat: OPENCHAMBER_SERVICE_TOKEN is missing; start this service from OpenChamber.');
  process.exit(1);
}
if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  console.error('Boat: OPENCHAMBER_SERVICE_PORT is missing; start this service from OpenChamber.');
  process.exit(1);
}

const host = createServiceHost({ env: process.env });
const context = createServiceContext({
  setInstructions: (directory, text) => host.setInstructions(directory, text),
  emit: (topic, data) => host.emit(topic, data as JsonValue),
  setMark: (target, mark) => host.setMark(target, mark),
});

const route = createRouter([
  ...statusRoutes(context),
  ...sandboxRoutes(context),
  ...conversationRoutes(context),
  ...eventRoutes(context),
  ...createRoutes(context),
  ...agentRoutes(context),
  ...agentCatalogRoutes(context),
  ...opencodeSessionRoutes(context),
  ...opencodeChatRoutes(context),
  ...opencodeCatalogRoutes(context),
  ...opencodeEventRoutes(context),
  ...mentionRoutes(context),
  ...projectRoutes({
    projects: context.projects,
    onChanged: () => {
      void context.refresh().catch(() => {});
    },
  }),
  ...scheduleRoutes({
    onWake: () => {
      void context.refresh().catch(() => {});
    },
  }),
]);

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
    return;
  }

  const request = createRequestContext(req, res);
  if (request.path === '/health') {
    sendReply(res, request.reply(200, {}));
    return;
  }

  route(request).then((reply) => {
    sendReply(res, reply ?? request.reply(404, {}));
  }, (failure: unknown) => {
    console.error('Boat:', failure instanceof Error ? failure.message : failure);
    if (res.headersSent) res.end();
    else sendReply(res, request.reply(500, { error: 'Boat could not answer.' }));
  });
});

server.listen(port, '127.0.0.1', () => {
  installFollowerCleanup(context.followers, [context.opencodeFollowers]);
  // Sends the instructions once on start, then keeps them in step with the list.
  void context.refresh().catch(() => {});
});

process.on('unhandledRejection', (reason) => {
  console.error('Boat:', reason instanceof Error ? reason.message : reason);
});
