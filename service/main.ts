/**
 * The Boat extension's host service.
 *
 * It answers the Work Status section (`GET /status`, `POST /status`), keeps the
 * sandbox list warm for a few seconds so polling is cheap, and keeps the
 * agent-facing instructions in step with what actually exists. It also answers
 * the scheduled wake-up that refreshes both while no panel is open.
 */
import http from 'node:http';

import { createServiceHost, readServiceScheduleRequest } from '@openchamber/sdk';

import {
  BoatError,
  desktopUrl,
  extendSandbox,
  listConversations,
  listSandboxes,
  readLimits,
  resetBoatBinary,
  resumeSandbox,
  stopSandbox,
  type Sandbox,
} from './boat.ts';
import { actionId, buildInstructions, buildView, decodeActionId, isUp, type ActionVerb } from './rows.ts';

type Snapshot = {
  at: number;
  sandboxes: Sandbox[];
  error: Failure | null;
};

type Failure = { text: string; tone: 'warning' | 'error' };

const LIST_TTL_MS = 4_000;
const DESKTOP_TTL_MS = 5 * 60_000;
const AGENT_TTL_MS = 20_000;
const LIMITS_TTL_MS = 5 * 60_000;
const INSTRUCTIONS_RETRY_MS = 30_000;
const MAX_BODY_CHARS = 16 * 1024;
const MAX_MESSAGE_CHARS = 300;

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

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

const describe = (failure: unknown): Failure => {
  if (failure instanceof BoatError) {
    if (failure.code === 'missing-cli') {
      resetBoatBinary();
      return {
        text: 'The boat CLI was not found. Install it from https://docs.boat.dev, then reopen this section.',
        tone: 'error',
      };
    }
    if (failure.code === 'not-signed-in') {
      return {
        text: 'The boat CLI is not signed in. Run `boat login` in a terminal, then reopen this section.',
        tone: 'warning',
      };
    }
    return { text: clip(failure.message, MAX_MESSAGE_CHARS), tone: 'error' };
  }
  return {
    text: clip(failure instanceof Error ? failure.message : 'Boat could not be reached.', MAX_MESSAGE_CHARS),
    tone: 'error',
  };
};

// ---------------------------------------------------------------- state

let snapshot: Snapshot | null = null;
let loading: Promise<Snapshot> | null = null;

const desktopUrls = new Map<string, { at: number; url: string | null }>();
const agentChecks = new Map<string, number>();
const runningAgents = new Set<string>();
let planNote: string | null = null;
let planNoteAt = 0;

let instructionsSent: string | null = null;
let instructionsRetryAt = 0;

const syncInstructions = async (sandboxes: Sandbox[], error: Failure | null): Promise<void> => {
  const text = buildInstructions(sandboxes, Date.now(), error?.text ?? null);
  if (text === instructionsSent || Date.now() < instructionsRetryAt) return;
  try {
    await host.setInstructions(null, text);
    instructionsSent = text;
  } catch {
    // Running outside OpenChamber, or the host has not granted instructions yet.
    instructionsRetryAt = Date.now() + INSTRUCTIONS_RETRY_MS;
  }
};

const refreshPlanNote = (): void => {
  const now = Date.now();
  if (now - planNoteAt < LIMITS_TTL_MS) return;
  planNoteAt = now;
  void readLimits().then((limits) => {
    if (!limits.canStart && limits.blockedReason) {
      planNote = limits.blockedReason;
      return;
    }
    if (limits.active !== null && limits.maxActive !== null && limits.active >= limits.maxActive) {
      planNote = `All ${limits.maxActive} sandbox slots are in use. Stop one to start another.`;
      return;
    }
    planNote = null;
  }, () => {
    planNote = null;
  });
};

const warm = (current: Snapshot): void => {
  const now = Date.now();
  const ids = new Set(current.sandboxes.map((sandbox) => sandbox.id));

  for (const sandbox of current.sandboxes) {
    if (!isUp(sandbox.state)) continue;

    const desktop = desktopUrls.get(sandbox.id);
    if (sandbox.desktopAvailable && (!desktop || now - desktop.at > DESKTOP_TTL_MS)) {
      // Claim the slot first so a slow call is not started again on the next poll.
      desktopUrls.set(sandbox.id, { at: now, url: desktop?.url ?? null });
      void desktopUrl(sandbox.id).then((url) => {
        desktopUrls.set(sandbox.id, { at: Date.now(), url });
      }, () => {
        desktopUrls.set(sandbox.id, { at: Date.now(), url: null });
      });
    }

    const checked = agentChecks.get(sandbox.id) ?? 0;
    if (now - checked > AGENT_TTL_MS) {
      agentChecks.set(sandbox.id, now);
      void listConversations(sandbox.id).then((conversations) => {
        if (conversations.some((conversation) => conversation.running)) runningAgents.add(sandbox.id);
        else runningAgents.delete(sandbox.id);
      }, () => {
        // An unreadable conversation list only hides the badge.
      });
    }
  }

  for (const id of [...desktopUrls.keys()]) if (!ids.has(id)) desktopUrls.delete(id);
  for (const id of [...agentChecks.keys()]) if (!ids.has(id)) agentChecks.delete(id);
  for (const id of [...runningAgents]) if (!ids.has(id)) runningAgents.delete(id);

  refreshPlanNote();
};

const loadSnapshot = async (): Promise<Snapshot> => {
  let sandboxes: Sandbox[] = [];
  let error: Failure | null = null;
  try {
    sandboxes = await listSandboxes();
  } catch (failure) {
    error = describe(failure);
    // Keep the last known rows on a transient failure; they are still useful.
    sandboxes = snapshot?.sandboxes ?? [];
  }
  const next: Snapshot = { at: Date.now(), sandboxes, error };
  snapshot = next;
  warm(next);
  void syncInstructions(next.sandboxes, next.error);
  return next;
};

/** The list, from cache when it is younger than a few seconds. Never throws. */
const getSnapshot = async (force = false): Promise<Snapshot> => {
  if (!force && snapshot && Date.now() - snapshot.at < LIST_TTL_MS) return snapshot;
  if (loading) return loading;
  loading = loadSnapshot().finally(() => {
    loading = null;
  });
  return loading;
};

const renderView = (current: Snapshot) => buildView({
  sandboxes: current.sandboxes,
  desktopUrls: new Map([...desktopUrls].map(([id, entry]) => [id, entry.url])),
  agents: runningAgents,
  error: current.error,
  planNote,
  now: Date.now(),
});

// ---------------------------------------------------------------- actions

type ActionRequest = { verb: ActionVerb; sandboxId: string };

const readAction = (body: string, current: Snapshot): ActionRequest | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body || '{}');
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const id = (parsed as { id?: unknown }).id;
  if (typeof id !== 'string') return null;

  const decoded = decodeActionId(id);
  if (!decoded) return null;
  // Action ids swap `_` for `-`; match against the live list first so an id with
  // more than one underscore still finds its sandbox.
  const known = current.sandboxes.find((sandbox) => actionId(decoded.verb, sandbox.id) === id);
  return known ? { verb: decoded.verb, sandboxId: known.id } : decoded;
};

const extendSeconds = (sandbox: Sandbox | undefined): number => {
  const now = Date.now();
  const deadline = sandbox?.archiveAfter ? Date.parse(sandbox.archiveAfter) : Number.NaN;
  const base = Number.isFinite(deadline) && deadline > now ? deadline : now;
  return Math.ceil((base - now) / 1000) + 3_600;
};

const applyAction = async (request: ActionRequest, current: Snapshot): Promise<void> => {
  switch (request.verb) {
    case 'stop':
      await stopSandbox(request.sandboxId);
      return;
    case 'resume':
      await resumeSandbox(request.sandboxId);
      return;
    case 'extend': {
      const sandbox = current.sandboxes.find((candidate) => candidate.id === request.sandboxId);
      await extendSandbox(request.sandboxId, extendSeconds(sandbox));
      return;
    }
  }
};

// ---------------------------------------------------------------- http

const sendJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req: http.IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    body += chunk;
    if (body.length > MAX_BODY_CHARS) {
      reject(new Error('Request body is too large.'));
      req.destroy();
    }
  });
  req.on('end', () => resolve(body));
  req.on('error', reject);
});

const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
    return;
  }

  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

  if (path === '/health') {
    sendJson(res, 200, {});
    return;
  }

  if (path === '/status') {
    if (req.method === 'GET') {
      try {
        sendJson(res, 200, renderView(await getSnapshot()));
      } catch (failure) {
        // A section never shows an error page; it says what went wrong in a row.
        sendJson(res, 200, {
          rows: [{
            kind: 'note',
            id: 'note-error',
            text: clip(describe(failure).text, MAX_MESSAGE_CHARS),
            tone: 'error',
          }],
        });
      }
      return;
    }
    if (req.method === 'POST') {
      const current = await getSnapshot();
      const body = await readBody(req);
      const request = readAction(body, current);
      if (!request) {
        sendJson(res, 422, { message: 'That control is no longer recognised. Reopen the section.' });
        return;
      }
      try {
        await applyAction(request, current);
      } catch (failure) {
        const reported = describe(failure);
        sendJson(res, 502, { message: reported.text });
        return;
      }
      // The next poll sees the new state, and instructions follow it.
      await getSnapshot(true);
      sendJson(res, 200, {});
      return;
    }
    sendJson(res, 405, { message: 'Only GET and POST are supported.' });
    return;
  }

  if (path === '/schedule' && req.method === 'POST') {
    const body = await readBody(req);
    if (!readServiceScheduleRequest(body)) {
      sendJson(res, 400, {});
      return;
    }
    sendJson(res, 200, { ok: true });
    // Refresh after answering: the clock's deadline is shorter than a CLI call.
    void getSnapshot(true).catch(() => {});
    return;
  }

  sendJson(res, 404, {});
};

const server = http.createServer((req, res) => {
  handle(req, res).catch((failure: unknown) => {
    console.error('Boat:', failure instanceof Error ? failure.message : failure);
    if (!res.headersSent) sendJson(res, 500, {});
    else res.end();
  });
});

server.listen(port, '127.0.0.1', () => {
  // Sends the instructions once on start, then keeps them in step with the list.
  void getSnapshot(true).catch(() => {});
});

process.on('unhandledRejection', (reason) => {
  console.error('Boat:', reason instanceof Error ? reason.message : reason);
});
