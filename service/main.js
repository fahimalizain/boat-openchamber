// service/main.ts
import http from "node:http";
// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = new WeakMap;
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== undefined)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1000));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;
// node_modules/@openchamber/sdk/dist/manifest.js
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);
// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_IDLE_MS = 10 * 60000;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_HOST_PATH = "/service/call";
var OPENCHAMBER_HOST_CALLBACK_URL_ENV = "OPENCHAMBER_HOST_CALLBACK_URL";
var SERVICE_HOST_TIMEOUT_MS = 30000;
var SERVICE_SCHEDULE_WIRE_VERSION = 1;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 60000;
var readServiceScheduleRequest = (body) => {
  let wire;
  try {
    wire = JSON.parse(body);
  } catch {
    return null;
  }
  if (Object(wire) !== wire || wire === null)
    return null;
  const { v, requestId, id, at } = wire;
  if (v !== SERVICE_SCHEDULE_WIRE_VERSION)
    return null;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (String(id) !== id || id.length === 0)
    return null;
  if (!Number.isFinite(at))
    return null;
  return { v: SERVICE_SCHEDULE_WIRE_VERSION, requestId, id, at: Number(at) };
};
var MENTIONS_IDLE_MS = 10 * 60000;
class ServiceHostError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "ServiceHostError";
    this.code = code;
    this.status = status;
  }
}
var createServiceHost = ({ env }) => {
  const call = async (method, input) => {
    const base = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
    const token = env.OPENCHAMBER_SERVICE_TOKEN;
    if (!base || !token)
      throw new ServiceHostError("This service was not started by OpenChamber.", "HOST_UNAVAILABLE", 0);
    let response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}${SERVICE_HOST_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method, input }),
        signal: AbortSignal.timeout(SERVICE_HOST_TIMEOUT_MS)
      });
    } catch {
      throw new ServiceHostError("OpenChamber did not answer.", "HOST_UNAVAILABLE", 0);
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.result !== undefined)
      return body.result;
    throw new ServiceHostError(body?.error?.message ?? `OpenChamber answered HTTP ${response.status}.`, body?.error?.code ?? "HOST_UNAVAILABLE", response.status);
  };
  return {
    sessions: {
      start: (input) => call("sessions.start", input),
      send: (sessionId, prompt) => call("sessions.send", { sessionId, prompt }),
      retry: (sessionId) => call("sessions.retry", { sessionId }),
      status: (sessionId) => call("sessions.status", { sessionId }),
      lastReply: (sessionId) => call("sessions.lastReply", { sessionId }),
      stop: (sessionId) => call("sessions.stop", { sessionId }),
      answerPermission: (sessionId, requestId, answer) => call("sessions.answerPermission", { sessionId, requestId, ...answer }),
      answerForm: (sessionId, formId, values, message) => call("sessions.answerForm", { sessionId, formId, values, ...message === undefined ? {} : { message } })
    },
    setInstructions: (directory, text) => call("instructions.set", { directory, text }),
    emit: (topic, data) => call("panels.emit", { topic, data }),
    readSettings: () => call("settings.read", {}).then(({ settings }) => settings),
    needsConfiguration: (message) => call("status.set", { needsConfiguration: message })
  };
};
// node_modules/@openchamber/sdk/dist/file-editor.js
var patternExpressions = new Map;
// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 60000;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
var HOST_PUSH_TYPES = new Set([
  "workspace",
  "shells",
  "ready",
  "directory",
  "session",
  "connection",
  "settings",
  "session-lifecycle",
  "item",
  "resolve",
  "action",
  "service-event",
  "status-control-event",
  "popover-closed",
  "file-open",
  "file-snapshot",
  "file-saved",
  "generate-late"
]);
// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 60000;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 60000;
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 60000;
var TRACKER_PROVIDER_IDLE_MS = 10 * 60000;
var QUOTA_PROVIDER_IDLE_MS = 10 * 60000;
// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);
// service/boat.ts
import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

class BoatError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "BoatError";
    this.code = code;
  }
}
var DEFAULT_TIMEOUT_MS = 20000;
var MUTATION_TIMEOUT_MS = 25000;
var MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var readString = (value) => typeof value === "string" && value.trim().length > 0 ? value : null;
var readNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
var parseJsonOutput = (output) => {
  const text = output.trim();
  if (!text)
    return null;
  try {
    return JSON.parse(text);
  } catch {}
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("["))
      continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch {}
  }
  return items.length > 0 ? items : null;
};
var errorMessage = (stdout, stderr, fallback) => {
  const parsed = parseJsonOutput(stdout) ?? parseJsonOutput(stderr);
  const record = isRecord(parsed) ? parsed : Array.isArray(parsed) && isRecord(parsed[0]) ? parsed[0] : null;
  if (record) {
    const nested = isRecord(record.error) ? record.error : null;
    const message = readString(nested?.message) ?? readString(record.message) ?? readString(record.error);
    if (message)
      return message;
  }
  const lines = [stderr, stdout].flatMap((stream) => stream.split(/\r?\n/).map((line) => line.trim()));
  return lines.find(Boolean) ?? fallback;
};
var isExecutable = (path) => {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};
var onPath = (name) => {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory)
      continue;
    const candidate = join(directory, name);
    if (isExecutable(candidate))
      return candidate;
  }
  return null;
};
var resolvedBinary;
var boatBinary = () => {
  if (resolvedBinary !== undefined)
    return resolvedBinary;
  const candidates = [
    process.env.BOAT_BIN?.trim(),
    onPath("boat"),
    join(homedir(), ".ascii", "bin", "boat"),
    "/opt/homebrew/bin/boat",
    "/usr/local/bin/boat"
  ].filter((candidate) => Boolean(candidate));
  resolvedBinary = candidates.find(isExecutable) ?? null;
  return resolvedBinary;
};
var resetBoatBinary = () => {
  resolvedBinary = undefined;
};
var run = async (command, args, options = {}) => {
  const binary = boatBinary();
  if (!binary) {
    throw new BoatError("missing-cli", "The boat CLI was not found. Install it from https://docs.boat.dev and restart this extension.");
  }
  const stdout = await new Promise((resolve, reject) => {
    execFile(binary, [command, "--json", "--no-update", ...args], {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: { ...process.env, BOAT_NO_UPDATE: "1" }
    }, (error, out, err) => {
      if (!error) {
        resolve(out);
        return;
      }
      const message = error.killed ? `boat ${command} did not finish in ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s.` : errorMessage(out, err, error.message || "The boat CLI failed.");
      const code = /not signed in|signed out|session expired|boat login/i.test(message) ? "not-signed-in" : "command-failed";
      reject(new BoatError(code, message));
    });
  });
  return parseJsonOutput(stdout);
};
var listSandboxes = async () => {
  const data = await run("list", ["--all"]);
  const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.sandboxes) ? data.sandboxes : [];
  return rows.filter(isRecord).flatMap((row) => {
    const id = readString(row.id);
    if (!id)
      return [];
    return [{
      id,
      name: readString(row.name) ?? id,
      state: readString(row.state) ?? "unknown",
      type: readString(row.type),
      vcpu: readNumber(row.vcpu),
      memoryGB: readNumber(row.memoryGB),
      createdAt: readString(row.createdAt),
      archiveAfter: readString(row.archiveAfter),
      stoppedAt: readString(row.stoppedAt),
      url: readString(row.url),
      ttlSeconds: readNumber(row.ttlSeconds),
      desktopAvailable: row.desktopAvailable === true,
      environment: readString(row.environment),
      health: readString(row.health),
      sshEndpoint: readString(row.sshEndpoint)
    }];
  });
};
var stopSandbox = async (id) => {
  await run("stop", [id, "--yes"], { timeoutMs: MUTATION_TIMEOUT_MS });
};
var resumeSandbox = async (id) => {
  await run("resume", [id, "--no-wait"], { timeoutMs: MUTATION_TIMEOUT_MS });
};
var extendSandbox = async (id, seconds) => {
  await run("extend", [id, "--ttl", String(Math.max(60, Math.round(seconds)))], { timeoutMs: MUTATION_TIMEOUT_MS });
};
var desktopUrl = async (id) => {
  const data = await run("desktop", [id], { timeoutMs: 1e4 });
  if (!isRecord(data))
    return null;
  const url = readString(data.desktopUrl) ?? readString(data.viewerUrl);
  return url && /^https?:\/\//i.test(url) ? url : null;
};
var listConversations = async (id) => {
  const data = await run("conversations", [id], { timeoutMs: 1e4 });
  const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.conversations) ? data.conversations : [];
  return rows.filter(isRecord).map((row) => ({
    id: readString(row.id) ?? readString(row.conversationId),
    running: row.running === true || row.isRunning === true || row.active === true || readString(row.state) === "running" || readString(row.status) === "running"
  }));
};
var readLimits = async () => {
  const data = await run("limits", [], { timeoutMs: 15000 });
  const record = isRecord(data) ? data : {};
  return {
    canStart: record.canStart !== false,
    blockedReason: readString(record.blockedReason) ?? readString(record.startBlockedReason),
    active: readNumber(record.activeSandboxes),
    maxActive: readNumber(record.maxActiveSandboxes)
  };
};

// service/rows.ts
var ROWS_MAX = 16;
var ROW_ID_MAX = 40;
var LABEL_MAX = 60;
var VALUE_MAX = 80;
var NOTE_MAX = 300;
var TOOLTIP_MAX = 200;
var UP_STATES = new Set(["ready", "idle", "running"]);
var BOOTING_STATES = new Set(["provisioned", "cloning"]);
var PENDING_STATES = new Set(["provisioned", "cloning", "stopping"]);
var isUp = (state) => UP_STATES.has(state);
var clip = (text, max) => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
var actionId = (verb, sandboxId) => clip(`${verb}-${sandboxId.replace(/_/g, "-").toLowerCase()}`, ROW_ID_MAX);
var decodeActionId = (id) => {
  const match = /^(stop|extend|resume)-([a-z0-9-]{1,32})$/.exec(id);
  if (!match?.[1] || !match[2])
    return null;
  const verb = match[1];
  return { verb, sandboxId: match[2].replace("-", "_") };
};
var formatDuration = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  if (totalSeconds < 60)
    return `${totalSeconds}s`;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60)
    return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};
var sizeOf = (sandbox) => {
  const parts = [sandbox.type, sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`].filter(Boolean);
  return parts.length === 0 ? null : parts.join(" ");
};
var timeLeft = (sandbox, now) => {
  if (!isUp(sandbox.state))
    return null;
  if (!sandbox.archiveAfter)
    return sandbox.ttlSeconds === null ? "no auto-stop" : null;
  const deadline = Date.parse(sandbox.archiveAfter);
  if (!Number.isFinite(deadline))
    return null;
  const remaining = deadline - now;
  return remaining <= 0 ? "auto-stop due" : `${formatDuration(remaining)} left`;
};
var valueOf = (sandbox, now) => {
  const parts = [sandbox.state, sizeOf(sandbox), timeLeft(sandbox, now)].filter(Boolean);
  return clip(parts.join(" · "), VALUE_MAX);
};
var dotOf = (state) => {
  if (UP_STATES.has(state))
    return "success";
  if (PENDING_STATES.has(state))
    return "warning";
  if (state === "stopped")
    return "muted";
  if (state === "error")
    return "error";
  return "muted";
};
var tooltipOf = (sandbox, now) => {
  const parts = [
    sandbox.id,
    sandbox.environment ? `env ${sandbox.environment}` : null,
    sandbox.vcpu === null ? null : `${sandbox.vcpu} vCPU`,
    sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`,
    sandbox.sshEndpoint ? `ssh ${sandbox.sshEndpoint}` : null,
    sandbox.archiveAfter ? `auto-stops ${new Date(Date.parse(sandbox.archiveAfter)).toLocaleString()} (in ${formatDuration(Date.parse(sandbox.archiveAfter) - now)})` : null
  ].filter(Boolean);
  return clip(parts.join(" · "), TOOLTIP_MAX);
};
var actionsOf = (sandbox) => {
  if (!isUp(sandbox.state)) {
    if (sandbox.state === "stopped") {
      return [{ kind: "button", id: actionId("resume", sandbox.id), label: "Resume" }];
    }
    if (BOOTING_STATES.has(sandbox.state)) {
      return [{
        kind: "button",
        id: actionId("stop", sandbox.id),
        label: "Cancel",
        variant: "destructive",
        confirm: "Stop this sandbox while it is still starting?"
      }];
    }
    return [];
  }
  const extend = {
    kind: "button",
    id: actionId("extend", sandbox.id),
    label: "Extend 1h",
    variant: "outline",
    disabled: !sandbox.archiveAfter && sandbox.ttlSeconds === null
  };
  return [
    { kind: "button", id: actionId("stop", sandbox.id), label: "Stop", variant: "destructive", confirm: "Stop this sandbox?" },
    extend
  ];
};
var desktopChip = (sandbox, desktopUrls) => {
  const url = desktopUrls.get(sandbox.id);
  if (!url || !isUp(sandbox.state))
    return null;
  return { id: clip(`desk-${sandbox.id.replace(/_/g, "-").toLowerCase()}`, ROW_ID_MAX), label: "Desktop", url };
};
var orderOf = (sandbox) => {
  if (UP_STATES.has(sandbox.state))
    return 0;
  if (PENDING_STATES.has(sandbox.state))
    return 1;
  if (sandbox.state === "stopped")
    return 2;
  return 3;
};
var buildView = (input) => {
  const notes = [];
  if (input.error) {
    notes.push({
      kind: "note",
      id: "note-error",
      text: clip(input.error.text, NOTE_MAX),
      tone: input.error.tone
    });
  }
  if (!input.error && input.sandboxes.length === 0) {
    notes.push({
      kind: "note",
      id: "note-empty",
      text: "No sandboxes. Create one with `boat new`, then reopen this section.",
      tone: "info"
    });
  }
  if (input.planNote) {
    notes.push({ kind: "note", id: "note-plan", text: clip(input.planNote, NOTE_MAX), tone: "warning" });
  }
  const lines = input.sandboxes.slice().sort((left, right) => {
    const live = Number(input.agents.has(right.id)) - Number(input.agents.has(left.id));
    if (live !== 0)
      return live;
    const order = orderOf(left) - orderOf(right);
    if (order !== 0)
      return order;
    return (Date.parse(right.createdAt ?? "") || 0) - (Date.parse(left.createdAt ?? "") || 0);
  }).map((sandbox) => {
    const row = {
      kind: "line",
      id: clip(`sb-${sandbox.id.replace(/_/g, "-").toLowerCase()}`, ROW_ID_MAX),
      label: clip(sandbox.name || sandbox.id, LABEL_MAX),
      dot: dotOf(sandbox.state),
      value: valueOf(sandbox, input.now),
      tooltip: tooltipOf(sandbox, input.now),
      actions: actionsOf(sandbox)
    };
    if (input.agents.has(sandbox.id))
      row.badge = { label: "agent running", tone: "accent" };
    const chip = desktopChip(sandbox, input.desktopUrls);
    if (chip)
      row.content = { kind: "chips", chips: [chip] };
    return row;
  });
  const room = Math.max(0, ROWS_MAX - notes.length);
  return { rows: [...lines.slice(0, room), ...notes] };
};
var buildInstructions = (sandboxes, now, error = null) => {
  if (error && sandboxes.length === 0) {
    return clip(`Boat cloud sandboxes are unavailable. ${error}`, 1000);
  }
  const lines = [
    "Boat sandboxes (boat.dev) managed by the Boat extension, reachable with the `boat` CLI:"
  ];
  const shown = sandboxes.slice(0, 12);
  if (shown.length === 0) {
    lines.push("- none right now. Create one with `boat new`.");
  } else {
    for (const sandbox of shown) {
      const details = [sandbox.state, sizeOf(sandbox), timeLeft(sandbox, now)].filter(Boolean).join(", ");
      lines.push(`- ${sandbox.id} "${sandbox.name}": ${details}`);
    }
    if (sandboxes.length > shown.length)
      lines.push(`- and ${sandboxes.length - shown.length} more (see \`boat list\`).`);
  }
  lines.push('Run commands with `boat exec <id> -- <command>`. Ask a sandbox agent with `boat prompt <id> --provider <claude|codex|opencode|pi|kimi|mistral|prime> --model <model> [--new | --resume <conversation>] "<text>"`; add to a running turn with `boat steer <id> --convo <conversation> "<text>"`, stop it with `boat interrupt <id>`. Pass `--json --no-update` to every command.');
  return clip(lines.join(`
`), 4000);
};

// service/main.ts
var LIST_TTL_MS = 4000;
var DESKTOP_TTL_MS = 5 * 60000;
var AGENT_TTL_MS = 20000;
var LIMITS_TTL_MS = 5 * 60000;
var INSTRUCTIONS_RETRY_MS = 30000;
var MAX_BODY_CHARS = 16 * 1024;
var MAX_MESSAGE_CHARS = 300;
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (!token) {
  console.error("Boat: OPENCHAMBER_SERVICE_TOKEN is missing; start this service from OpenChamber.");
  process.exit(1);
}
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error("Boat: OPENCHAMBER_SERVICE_PORT is missing; start this service from OpenChamber.");
  process.exit(1);
}
var host = createServiceHost({ env: process.env });
var clip2 = (text, max) => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
var describe = (failure) => {
  if (failure instanceof BoatError) {
    if (failure.code === "missing-cli") {
      resetBoatBinary();
      return {
        text: "The boat CLI was not found. Install it from https://docs.boat.dev, then reopen this section.",
        tone: "error"
      };
    }
    if (failure.code === "not-signed-in") {
      return {
        text: "The boat CLI is not signed in. Run `boat login` in a terminal, then reopen this section.",
        tone: "warning"
      };
    }
    return { text: clip2(failure.message, MAX_MESSAGE_CHARS), tone: "error" };
  }
  return {
    text: clip2(failure instanceof Error ? failure.message : "Boat could not be reached.", MAX_MESSAGE_CHARS),
    tone: "error"
  };
};
var snapshot = null;
var loading = null;
var desktopUrls = new Map;
var agentChecks = new Map;
var runningAgents = new Set;
var planNote = null;
var planNoteAt = 0;
var instructionsSent = null;
var instructionsRetryAt = 0;
var syncInstructions = async (sandboxes, error) => {
  const text = buildInstructions(sandboxes, Date.now(), error?.text ?? null);
  if (text === instructionsSent || Date.now() < instructionsRetryAt)
    return;
  try {
    await host.setInstructions(null, text);
    instructionsSent = text;
  } catch {
    instructionsRetryAt = Date.now() + INSTRUCTIONS_RETRY_MS;
  }
};
var refreshPlanNote = () => {
  const now = Date.now();
  if (now - planNoteAt < LIMITS_TTL_MS)
    return;
  planNoteAt = now;
  readLimits().then((limits) => {
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
var warm = (current) => {
  const now = Date.now();
  const ids = new Set(current.sandboxes.map((sandbox) => sandbox.id));
  for (const sandbox of current.sandboxes) {
    if (!isUp(sandbox.state))
      continue;
    const desktop = desktopUrls.get(sandbox.id);
    if (sandbox.desktopAvailable && (!desktop || now - desktop.at > DESKTOP_TTL_MS)) {
      desktopUrls.set(sandbox.id, { at: now, url: desktop?.url ?? null });
      desktopUrl(sandbox.id).then((url) => {
        desktopUrls.set(sandbox.id, { at: Date.now(), url });
      }, () => {
        desktopUrls.set(sandbox.id, { at: Date.now(), url: null });
      });
    }
    const checked = agentChecks.get(sandbox.id) ?? 0;
    if (now - checked > AGENT_TTL_MS) {
      agentChecks.set(sandbox.id, now);
      listConversations(sandbox.id).then((conversations) => {
        if (conversations.some((conversation) => conversation.running))
          runningAgents.add(sandbox.id);
        else
          runningAgents.delete(sandbox.id);
      }, () => {});
    }
  }
  for (const id of [...desktopUrls.keys()])
    if (!ids.has(id))
      desktopUrls.delete(id);
  for (const id of [...agentChecks.keys()])
    if (!ids.has(id))
      agentChecks.delete(id);
  for (const id of [...runningAgents])
    if (!ids.has(id))
      runningAgents.delete(id);
  refreshPlanNote();
};
var loadSnapshot = async () => {
  let sandboxes = [];
  let error = null;
  try {
    sandboxes = await listSandboxes();
  } catch (failure) {
    error = describe(failure);
    sandboxes = snapshot?.sandboxes ?? [];
  }
  const next = { at: Date.now(), sandboxes, error };
  snapshot = next;
  warm(next);
  syncInstructions(next.sandboxes, next.error);
  return next;
};
var getSnapshot = async (force = false) => {
  if (!force && snapshot && Date.now() - snapshot.at < LIST_TTL_MS)
    return snapshot;
  if (loading)
    return loading;
  loading = loadSnapshot().finally(() => {
    loading = null;
  });
  return loading;
};
var renderView = (current) => buildView({
  sandboxes: current.sandboxes,
  desktopUrls: new Map([...desktopUrls].map(([id, entry]) => [id, entry.url])),
  agents: runningAgents,
  error: current.error,
  planNote,
  now: Date.now()
});
var readAction = (body, current) => {
  let parsed;
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return null;
  const id = parsed.id;
  if (typeof id !== "string")
    return null;
  const decoded = decodeActionId(id);
  if (!decoded)
    return null;
  const known = current.sandboxes.find((sandbox) => actionId(decoded.verb, sandbox.id) === id);
  return known ? { verb: decoded.verb, sandboxId: known.id } : decoded;
};
var extendSeconds = (sandbox) => {
  const now = Date.now();
  const deadline = sandbox?.archiveAfter ? Date.parse(sandbox.archiveAfter) : Number.NaN;
  const base = Number.isFinite(deadline) && deadline > now ? deadline : now;
  return Math.ceil((base - now) / 1000) + 3600;
};
var applyAction = async (request, current) => {
  switch (request.verb) {
    case "stop":
      await stopSandbox(request.sandboxId);
      return;
    case "resume":
      await resumeSandbox(request.sandboxId);
      return;
    case "extend": {
      const sandbox = current.sandboxes.find((candidate) => candidate.id === request.sandboxId);
      await extendSandbox(request.sandboxId, extendSeconds(sandbox));
      return;
    }
  }
};
var sendJson = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
var readBody = (req) => new Promise((resolve, reject) => {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY_CHARS) {
      reject(new Error("Request body is too large."));
      req.destroy();
    }
  });
  req.on("end", () => resolve(body));
  req.on("error", reject);
});
var handle = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
    return;
  }
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (path === "/health") {
    sendJson(res, 200, {});
    return;
  }
  if (path === "/status") {
    if (req.method === "GET") {
      try {
        sendJson(res, 200, renderView(await getSnapshot()));
      } catch (failure) {
        sendJson(res, 200, {
          rows: [{
            kind: "note",
            id: "note-error",
            text: clip2(describe(failure).text, MAX_MESSAGE_CHARS),
            tone: "error"
          }]
        });
      }
      return;
    }
    if (req.method === "POST") {
      const current = await getSnapshot();
      const body = await readBody(req);
      const request = readAction(body, current);
      if (!request) {
        sendJson(res, 422, { message: "That control is no longer recognised. Reopen the section." });
        return;
      }
      try {
        await applyAction(request, current);
      } catch (failure) {
        const reported = describe(failure);
        sendJson(res, 502, { message: reported.text });
        return;
      }
      await getSnapshot(true);
      sendJson(res, 200, {});
      return;
    }
    sendJson(res, 405, { message: "Only GET and POST are supported." });
    return;
  }
  if (path === "/schedule" && req.method === "POST") {
    const body = await readBody(req);
    if (!readServiceScheduleRequest(body)) {
      sendJson(res, 400, {});
      return;
    }
    sendJson(res, 200, { ok: true });
    getSnapshot(true).catch(() => {});
    return;
  }
  sendJson(res, 404, {});
};
var server = http.createServer((req, res) => {
  handle(req, res).catch((failure) => {
    console.error("Boat:", failure instanceof Error ? failure.message : failure);
    if (!res.headersSent)
      sendJson(res, 500, {});
    else
      res.end();
  });
});
server.listen(port, "127.0.0.1", () => {
  getSnapshot(true).catch(() => {});
});
process.on("unhandledRejection", (reason) => {
  console.error("Boat:", reason instanceof Error ? reason.message : reason);
});
