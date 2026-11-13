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
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
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
var SERVICE_MARK_TEXT_MAX = 200;
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
var MENTIONS_SEARCH_PATH = "/mentions/search";
var MENTIONS_RESOLVE_PATH = "/mentions/resolve";
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
    needsConfiguration: (message) => call("status.set", { needsConfiguration: message }),
    setMark: (target, mark) => call("marks.set", { target, mark })
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
// service/create/jobs.ts
import readline from "node:readline";

// service/boat.ts
import { execFile, spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

// shared/json.ts
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var readString = (value) => typeof value === "string" && value.trim().length > 0 ? value : null;
var readNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
var clip = (text, max) => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

// service/boat.ts
class BoatError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "BoatError";
    this.code = code;
  }
}
var MISSING_CLI_MESSAGE = "The boat CLI was not found. Install it from https://docs.boat.dev and restart this extension.";
var DEFAULT_TIMEOUT_MS = 20000;
var MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
var parseBoatJson = (output) => {
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
var readBoatLine = (raw) => {
  if (!isRecord(raw))
    return null;
  const event = readString(raw.event);
  const final = typeof raw.final === "boolean" ? raw.final : null;
  const data = isRecord(raw.data) ? raw.data : null;
  if (event && data) {
    return { value: { ...data, event }, event, final };
  }
  return { value: raw, event, final };
};
var errorMessage = (stdout, stderr, fallback) => {
  const parsed = parseBoatJson(stdout) ?? parseBoatJson(stderr);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  const record = readBoatLine(first)?.value ?? null;
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
var cachedBinary = null;
var boatBinary = () => {
  if (cachedBinary)
    return cachedBinary;
  const candidates = [
    process.env.BOAT_BIN?.trim(),
    onPath("boat"),
    join(homedir(), ".ascii", "bin", "boat"),
    "/opt/homebrew/bin/boat",
    "/usr/local/bin/boat"
  ].filter((candidate) => Boolean(candidate));
  cachedBinary = candidates.find(isExecutable) ?? null;
  return cachedBinary;
};
var requireBinary = () => {
  const binary = boatBinary();
  if (!binary)
    throw new BoatError("missing-cli", MISSING_CLI_MESSAGE);
  return binary;
};
var boatEnv = () => ({ ...process.env, BOAT_NO_UPDATE: "1" });
var runBoat = async (command, args, options = {}) => {
  const binary = requireBinary();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stdout = await new Promise((resolve, reject) => {
    execFile(binary, [command, "--json", "--no-update", ...args], { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, env: boatEnv() }, (error, out, err) => {
      if (!error) {
        resolve(out);
        return;
      }
      const message = error.killed ? `boat ${command} did not finish in ${Math.round(timeoutMs / 1000)}s.` : errorMessage(out, err, error.message || "The boat CLI failed.");
      const code = /not signed in|signed out|session expired|boat login/i.test(message) ? "not-signed-in" : "command-failed";
      reject(new BoatError(code, message));
    });
  });
  return parseBoatJson(stdout);
};
var spawnBoat = (command, args) => spawn(requireBinary(), [command, "--json", "--no-update", ...args], {
  env: boatEnv(),
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

// service/create/progress.ts
var parseCreateLine = (value) => {
  const line = readBoatLine(value);
  if (!line)
    return null;
  const record = line.value;
  const event = readString(record.event) ?? line.event;
  const nested = isRecord(record.error) ? record.error : null;
  return {
    sandboxId: readString(record.id) ?? readString(record.sandboxId),
    ready: event === "ready",
    failure: event === "error" ? readString(nested?.message) ?? readString(record.error) ?? readString(record.message) ?? "The create failed." : null
  };
};

// service/create/jobs.ts
var createCreateJobs = (deps) => {
  let child = null;
  const finish = async (input, sandboxId) => {
    let warning = null;
    if (input.start.kind === "copy" && input.name) {
      try {
        await deps.rename(sandboxId, input.name);
      } catch (failure) {
        warning = `Created, but not renamed: ${failure instanceof Error ? failure.message : "unknown error"}`;
      }
    }
    deps.onReady(sandboxId);
    deps.emit({ state: "ready", sandboxId, ...warning ? { message: warning } : {} });
  };
  const start = (input) => {
    if (child)
      throw new BoatError("command-failed", "A sandbox is already being created.");
    const running = deps.spawn(input);
    child = running;
    let sandboxId = null;
    let failure = null;
    let stderr = "";
    deps.emit({ state: "starting" });
    const stdout = running.stdout;
    if (!stdout) {
      running.kill("SIGTERM");
      child = null;
      deps.emit({ state: "failed", message: "boat did not open its output." });
      return;
    }
    const lines = readline.createInterface({ input: stdout });
    lines.on("line", (line) => {
      const parsed = parseCreateLine(parseBoatJson(line));
      if (!parsed)
        return;
      if (parsed.sandboxId && parsed.sandboxId !== sandboxId) {
        sandboxId = parsed.sandboxId;
        deps.onCreated(parsed.sandboxId);
        deps.emit({ state: "created", sandboxId: parsed.sandboxId });
      }
      if (parsed.failure)
        failure = parsed.failure;
    });
    running.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2000);
    });
    running.on("error", (error) => {
      child = null;
      deps.emit({ state: "failed", message: error.message });
    });
    running.on("close", (code) => {
      child = null;
      if (failure) {
        deps.emit({ state: "failed", message: failure });
        return;
      }
      if (code === 0 && sandboxId) {
        finish(input, sandboxId);
        return;
      }
      if (code === 0) {
        deps.emit({ state: "failed", message: "boat finished without a sandbox id." });
        return;
      }
      const detail = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-1)[0];
      deps.emit({ state: "failed", message: detail ?? `boat exited with code ${code ?? "unknown"}.` });
    });
  };
  return { busy: () => child !== null, start };
};

// service/data/environment-list.ts
var createEnvironmentList = (options) => {
  let entries = [];
  let loadedAt = 0;
  let loading = null;
  const read = async () => {
    try {
      entries = await options.load();
    } catch {}
    loadedAt = Date.now();
    return entries;
  };
  return {
    get: async (settings = {}) => {
      if (!settings.force && loadedAt > 0 && Date.now() - loadedAt < options.ttlMs)
        return entries;
      if (loading)
        return loading;
      loading = read().finally(() => {
        loading = null;
      });
      return loading;
    }
  };
};

// service/create/argv.ts
var createCommand = (input) => {
  const args = [];
  if (input.size)
    args.push("--type", input.size);
  if (input.autoStopSeconds)
    args.push("--ttl", String(input.autoStopSeconds));
  if (input.start.kind === "copy") {
    if (input.environment)
      args.push("--environment", input.environment);
    return { command: "fork", args: [...args, "--wait", input.start.sandboxId] };
  }
  if (input.name)
    args.push("--name", input.name);
  if (input.environment)
    args.push("--environment", input.environment);
  if (input.start.kind === "snapshot")
    args.push("--from", input.start.name);
  return { command: "new", args };
};

// service/domain/sandboxes.ts
var MUTATION_TIMEOUT_MS = 25000;
var readLabels = (value) => {
  if (!isRecord(value))
    return {};
  const labels = {};
  for (const [key, entry] of Object.entries(value)) {
    const text = readString(entry);
    if (text)
      labels[key] = text;
  }
  return labels;
};
var toSandbox = (row) => {
  const id = readString(row.id);
  if (!id)
    return null;
  return {
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
    sshEndpoint: readString(row.sshEndpoint),
    labels: readLabels(row.labels)
  };
};
var listSandboxes = async () => {
  const data = await runBoat("list", ["--all"]);
  const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.sandboxes) ? data.sandboxes : [];
  return rows.filter(isRecord).flatMap((row) => {
    const sandbox = toSandbox(row);
    return sandbox ? [sandbox] : [];
  });
};
var stopSandbox = async (sandboxId) => {
  await runBoat("stop", [sandboxId, "--yes"], { timeoutMs: MUTATION_TIMEOUT_MS });
};
var resumeSandbox = async (sandboxId) => {
  await runBoat("resume", [sandboxId, "--no-wait"], { timeoutMs: MUTATION_TIMEOUT_MS });
};
var extendSandbox = async (sandboxId, seconds) => {
  await runBoat("extend", [sandboxId, "--ttl", String(Math.max(60, Math.round(seconds)))], {
    timeoutMs: MUTATION_TIMEOUT_MS
  });
};
var extendSeconds = (sandbox, now = Date.now()) => {
  const deadline = sandbox?.archiveAfter ? Date.parse(sandbox.archiveAfter) : Number.NaN;
  const base = Number.isFinite(deadline) && deadline > now ? deadline : now;
  return Math.ceil((base - now) / 1000) + 3600;
};
var readDesktopUrl = async (sandboxId) => {
  const data = await runBoat("desktop", [sandboxId], { timeoutMs: 1e4 });
  if (!isRecord(data))
    return null;
  const url = readString(data.desktopUrl) ?? readString(data.viewerUrl);
  return url && /^https?:\/\//i.test(url) ? url : null;
};
var spawnCreate = (input) => {
  const { command, args } = createCommand(input);
  return spawnBoat(command, args);
};
var renameSandbox = async (sandboxId, name) => {
  await runBoat("rename", [sandboxId, name], { timeoutMs: 20000 });
};

// service/data/desktop-links.ts
var createDesktopLinks = (options) => {
  const entries = new Map;
  const store = (sandboxId) => {
    const previous = entries.get(sandboxId);
    entries.set(sandboxId, { at: Date.now(), url: previous?.url ?? null });
    readDesktopUrl(sandboxId).then((url) => {
      entries.set(sandboxId, { at: Date.now(), url });
    }, () => {
      entries.set(sandboxId, { at: Date.now(), url: null });
    });
  };
  return {
    get: async (sandboxId) => {
      const cached = entries.get(sandboxId);
      if (cached?.url && Date.now() - cached.at < options.ttlMs)
        return cached.url;
      const url = await readDesktopUrl(sandboxId);
      entries.set(sandboxId, { at: Date.now(), url });
      return url;
    },
    all: () => new Map([...entries].map(([id, entry]) => [id, entry.url])),
    warm: (sandboxIds) => {
      const now = Date.now();
      for (const sandboxId of sandboxIds) {
        const cached = entries.get(sandboxId);
        if (cached && now - cached.at < options.ttlMs)
          continue;
        store(sandboxId);
      }
    },
    forget: (sandboxId) => {
      entries.delete(sandboxId);
    },
    sweep: (valid) => {
      for (const id of [...entries.keys()])
        if (!valid.has(id))
          entries.delete(id);
    }
  };
};

// shared/types.ts
var SANDBOX_SIZES = ["small", "default", "large", "xlarge"];
var isSandboxSize = (value) => SANDBOX_SIZES.includes(value);
var isUpState = (state) => state === "ready" || state === "idle" || state === "running";
var isBootingState = (state) => state === "provisioned" || state === "cloning";
var isPendingState = (state) => isBootingState(state) || state === "stopping";
var isStoppedState = (state) => state === "stopped";

// service/domain/limits.ts
var MAX_TTL_HOURS = 720;
var TRIAL_TTL_HOURS = 2;
var autoStopHoursOf = (record) => {
  const gift = isRecord(record.giftLimit) ? record.giftLimit : null;
  const giftSeconds = readNumber(gift?.maxTtlSeconds);
  if (giftSeconds !== null && giftSeconds > 0)
    return Math.max(1, Math.floor(giftSeconds / 3600));
  if (readString(record.billingStatus) === "trialing" || readString(record.accessTier) === "trial") {
    return TRIAL_TTL_HOURS;
  }
  return MAX_TTL_HOURS;
};
var sizesOf = (record) => {
  const rows = Array.isArray(record.machineTypes) ? record.machineTypes.filter(isRecord) : [];
  return SANDBOX_SIZES.map((id) => {
    const row = rows.find((entry) => readString(entry.type) === id);
    if (!row)
      return { id, available: true, reason: null };
    const available = row.available === true;
    return { id, available, reason: available ? null : readString(row.reason) };
  });
};
var readLimits = async () => {
  const data = await runBoat("limits", [], { timeoutMs: 15000 });
  const record = isRecord(data) ? data : {};
  return {
    canStart: record.canStart !== false,
    blockedReason: readString(record.blockedReason) ?? readString(record.startBlockedReason),
    active: readNumber(record.activeSandboxes),
    maxActive: readNumber(record.maxActiveSandboxes),
    autoStopMaxHours: autoStopHoursOf(record),
    sizes: sizesOf(record)
  };
};

// service/data/plan-note.ts
var createPlanNote = (options) => {
  let note = null;
  let refreshedAt = 0;
  return {
    current: () => note,
    refresh: () => {
      const now = Date.now();
      if (now - refreshedAt < options.ttlMs)
        return;
      refreshedAt = now;
      readLimits().then((limits) => {
        if (!limits.canStart && limits.blockedReason) {
          note = limits.blockedReason;
          return;
        }
        if (limits.active !== null && limits.maxActive !== null && limits.active >= limits.maxActive) {
          note = `All ${limits.maxActive} sandbox slots are in use. Stop one to start another.`;
          return;
        }
        note = null;
      }, () => {
        note = null;
      });
    }
  };
};

// service/data/project-registry.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, isAbsolute, join as join2 } from "node:path";
var MAX_PROJECTS = 24;
var DEFAULT_FILE = join2(homedir2(), ".boat-openchamber", "projects.json");
var usable = (directory) => typeof directory === "string" && isAbsolute(directory) && !directory.includes("\x00") && directory.length <= 1024;
var read = (file) => {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(parsed) || !Array.isArray(parsed.directories))
      return [];
    return parsed.directories.filter(usable).slice(0, MAX_PROJECTS);
  } catch {
    return [];
  }
};
var createProjectRegistry = (options = {}) => {
  const file = options.file ?? DEFAULT_FILE;
  const directories = new Set(read(file));
  const save = () => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ directories: [...directories] }, null, 2));
    } catch {}
  };
  return {
    list: () => [...directories],
    remember: (incoming) => {
      let changed = false;
      for (const directory of incoming) {
        if (!usable(directory) || directories.has(directory))
          continue;
        if (directories.size >= MAX_PROJECTS)
          break;
        directories.add(directory);
        changed = true;
      }
      if (changed)
        save();
    },
    replace: (incoming) => {
      const next = [...new Set(incoming.filter(usable))].slice(0, MAX_PROJECTS);
      const unchanged = next.length === directories.size && next.every((directory) => directories.has(directory));
      if (unchanged)
        return false;
      directories.clear();
      for (const directory of next)
        directories.add(directory);
      save();
      return true;
    }
  };
};

// service/failures.ts
var MAX_MESSAGE_CHARS = 300;
var describeFailure = (failure) => {
  if (failure instanceof BoatError) {
    if (failure.code === "missing-cli") {
      return {
        text: "The boat CLI was not found. Install it from https://docs.boat.dev, then reopen this panel.",
        tone: "error"
      };
    }
    if (failure.code === "not-signed-in") {
      return {
        text: "The boat CLI is not signed in. Run `boat login` in a terminal, then reopen this panel.",
        tone: "warning"
      };
    }
    return { text: clip(failure.message, MAX_MESSAGE_CHARS), tone: "error" };
  }
  return {
    text: clip(failure instanceof Error ? failure.message : "Boat could not be reached.", MAX_MESSAGE_CHARS),
    tone: "error"
  };
};

// service/data/sandbox-list.ts
var createSandboxList = (options) => {
  let current = null;
  let loading = null;
  const load = async () => {
    let sandboxes = [];
    let failure = null;
    try {
      sandboxes = await options.load();
    } catch (error) {
      failure = describeFailure(error);
      sandboxes = current?.sandboxes ?? [];
    }
    const next = { at: Date.now(), sandboxes, failure };
    current = next;
    options.onSnapshot?.(next);
    return next;
  };
  return {
    get: async (force = false) => {
      if (!force && current && Date.now() - current.at < options.ttlMs)
        return current;
      if (loading)
        return loading;
      loading = load().finally(() => {
        loading = null;
      });
      return loading;
    },
    peek: () => current,
    invalidate: () => {
      current = null;
    }
  };
};

// service/project/slug.ts
var normalizeRepoSlug = (value) => {
  const text = value.trim();
  if (!text)
    return null;
  const scp = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(text);
  if (scp?.[2])
    return fromPath(scp[2]);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      return fromPath(new URL(text).pathname);
    } catch {
      return null;
    }
  }
  return fromPath(text);
};
var fromPath = (path) => {
  const parts = path.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2)
    return null;
  const repo = parts[parts.length - 1]?.replace(/\.git$/i, "").toLowerCase() ?? "";
  const owner = parts[parts.length - 2]?.toLowerCase() ?? "";
  if (!/^[a-z0-9._-]+$/.test(owner) || !/^[a-z0-9._-]+$/.test(repo))
    return null;
  return `${owner}/${repo}`;
};

// service/domain/environments.ts
var repoOf = (entry) => {
  if (typeof entry === "string")
    return normalizeRepoSlug(entry);
  if (!isRecord(entry))
    return null;
  return normalizeRepoSlug(readString(entry.fullName) ?? readString(entry.name) ?? "");
};
var listEnvironments = async () => {
  const data = await runBoat("env", ["list"], { timeoutMs: 20000 });
  const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.environments) ? data.environments : [];
  const summaries = [];
  for (const row of rows) {
    if (!isRecord(row))
      continue;
    const name = readString(row.name);
    if (!name)
      continue;
    const repos = Array.isArray(row.selectedRepositories) ? row.selectedRepositories.flatMap((entry) => {
      const slug = repoOf(entry);
      return slug ? [slug] : [];
    }) : [];
    summaries.push({ name, repos, isDefault: row.isDefault === true });
  }
  return summaries;
};

// service/status/text.ts
var TEXT_MAX = 4000;
var SANDBOXES_SHOWN = 12;
var COMMANDS_LINE = "Run commands inside a sandbox with `boat exec <id> -- <command>`. Sandbox agents run in each sandbox's OpenCode server; drive them from the Boat panel — the Sessions tab, or the row menu's OpenCode item.";
var sizeOf = (sandbox) => {
  const parts = [sandbox.type, sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`].filter(Boolean);
  return parts.join(" ");
};
var leftOf = (sandbox, now) => {
  if (!isUpState(sandbox.state) || !sandbox.archiveAfter)
    return null;
  const deadline = Date.parse(sandbox.archiveAfter);
  if (!Number.isFinite(deadline))
    return null;
  const minutes = Math.max(0, Math.round((deadline - now) / 60000));
  if (minutes < 60)
    return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h left` : `${hours}h ${rest}m left`;
};
var sandboxLine = (sandbox, now) => {
  const details = [sandbox.state, sizeOf(sandbox), leftOf(sandbox, now)].filter(Boolean).join(", ");
  return `- ${sandbox.id} "${sandbox.name}": ${details}`;
};
var buildInstructions = (sandboxes, now, failure = null) => {
  if (failure && sandboxes.length === 0) {
    return clip(`Boat cloud sandboxes are unavailable. ${failure}`, 1000);
  }
  const lines = ["Boat sandboxes (boat.dev) managed by the Boat extension, reachable with the `boat` CLI:"];
  const shown = sandboxes.slice(0, SANDBOXES_SHOWN);
  if (shown.length === 0) {
    lines.push("- none right now. Create one with `boat new`.");
  } else {
    for (const sandbox of shown)
      lines.push(sandboxLine(sandbox, now));
    if (sandboxes.length > shown.length) {
      lines.push(`- and ${sandboxes.length - shown.length} more (see \`boat list\`).`);
    }
  }
  lines.push(COMMANDS_LINE);
  return clip(lines.join(`
`), TEXT_MAX);
};
var buildProjectInstructions = (projectName, sandboxes, now) => {
  const lines = [`Boat sandboxes for the "${projectName}" project (boat.dev):`];
  const shown = sandboxes.slice(0, SANDBOXES_SHOWN);
  if (shown.length === 0) {
    lines.push(`- none for this project. Pin one with the \`openchamber.project\` label, or add this repository to its boat environment.`);
  } else {
    for (const sandbox of shown)
      lines.push(sandboxLine(sandbox, now));
    if (sandboxes.length > shown.length) {
      lines.push(`- and ${sandboxes.length - shown.length} more (see \`boat list\`).`);
    }
  }
  lines.push(COMMANDS_LINE);
  return clip(lines.join(`
`), TEXT_MAX);
};

// service/instructions.ts
var MAX_PROJECTS2 = 8;
var createInstructionsWriter = (options) => {
  let globalSent = null;
  let globalRetryAt = 0;
  const projectSent = new Map;
  const projectRetryAt = new Map;
  const rememberProject = (directory, text) => {
    projectSent.delete(directory);
    projectSent.set(directory, text);
    if (projectSent.size <= MAX_PROJECTS2)
      return;
    const oldest = projectSent.keys().next().value;
    if (oldest)
      projectSent.delete(oldest);
  };
  return {
    sync: async (snapshot) => {
      const text = buildInstructions(snapshot.sandboxes, Date.now(), snapshot.failure?.text ?? null);
      if (text === globalSent || Date.now() < globalRetryAt)
        return;
      try {
        await options.setInstructions(null, text);
        globalSent = text;
      } catch {
        globalRetryAt = Date.now() + options.retryMs;
      }
    },
    syncProject: async (directory, text) => {
      if (projectSent.get(directory) === text)
        return;
      if (Date.now() < (projectRetryAt.get(directory) ?? 0))
        return;
      try {
        await options.setInstructions(directory, text);
        projectRetryAt.delete(directory);
        rememberProject(directory, text);
      } catch {
        projectRetryAt.set(directory, Date.now() + options.retryMs);
      }
    }
  };
};

// service/marks/mark.ts
var buildProjectMark = (sandboxes, busy) => {
  if (sandboxes.length === 0)
    return null;
  const running = sandboxes.filter((sandbox) => busy.has(sandbox.id)).length;
  const up = sandboxes.some((sandbox) => isUpState(sandbox.state));
  const text = [
    `${sandboxes.length} sandbox${sandboxes.length === 1 ? "" : "es"}`,
    running > 0 ? `${running} agent${running === 1 ? "" : "s"} running` : null
  ].filter(Boolean).join(" · ");
  return {
    icon: "anchor",
    tone: up || running > 0 ? "success" : "info",
    text: clip(text, SERVICE_MARK_TEXT_MAX)
  };
};
var sameMark = (left, right) => left === right || left !== null && right !== null && left.icon === right.icon && left.tone === right.tone && left.text === right.text;
var changedMarks = (previous, next) => {
  const changes = [];
  for (const [directory, mark] of next) {
    if (!sameMark(previous.get(directory) ?? null, mark))
      changes.push({ directory, mark });
  }
  for (const directory of previous.keys()) {
    if (!next.has(directory))
      changes.push({ directory, mark: null });
  }
  return changes;
};

// service/marks/marker.ts
var RATE_WINDOW_MS = 60000;
var RATE_MAX = 50;
var BACKOFF_MS = 60000;
var isRateLimited = (failure) => {
  if (typeof failure === "object" && failure !== null && "status" in failure) {
    if (failure.status === 429)
      return true;
  }
  const message = failure instanceof Error ? failure.message : "";
  return /429|rate limit|too many requests/i.test(message);
};
var createMarker = (deps) => {
  const previous = new Map;
  const calls = [];
  const now = deps.now ?? Date.now;
  let syncing = false;
  let cooldownUntil = 0;
  const withinRate = (at) => {
    while (calls.length > 0 && at - (calls[0] ?? 0) > RATE_WINDOW_MS)
      calls.shift();
    return calls.length < RATE_MAX;
  };
  const run = async (snapshot) => {
    if (now() < cooldownUntil)
      return;
    const next = new Map;
    for (const directory of deps.projects.list()) {
      try {
        const scope = await deps.scoper.apply(snapshot.sandboxes, directory);
        const sandboxes = scope.entries.filter((entry) => entry.inProject).map((entry) => entry.sandbox);
        next.set(directory, buildProjectMark(sandboxes, deps.sessions.busyAll()));
      } catch {
        const current = previous.get(directory);
        if (current !== undefined)
          next.set(directory, current);
      }
    }
    for (const change of changedMarks(previous, next)) {
      if (!withinRate(now()))
        return;
      try {
        await deps.setMark({ directory: change.directory }, change.mark);
        calls.push(now());
        if (change.mark)
          previous.set(change.directory, change.mark);
        else
          previous.delete(change.directory);
      } catch (failure) {
        if (isRateLimited(failure)) {
          cooldownUntil = now() + BACKOFF_MS;
          return;
        }
      }
    }
  };
  return {
    sync: (snapshot) => {
      if (syncing)
        return;
      syncing = true;
      run(snapshot).finally(() => {
        syncing = false;
      });
    }
  };
};
// node_modules/@opencode/client/dist/chunks/contract-9rqn6x4v.js
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// node_modules/@opencode/client/dist/chunks/contract-gecjxyvt.js
var exports_shared_events = {};
__export(exports_shared_events, {
  SharedEvents: () => exports_shared_events,
  make: () => make7
});
function make7(connect) {
  let current;
  const capacity = 4096;
  function stop(connection) {
    connection.connected = undefined;
    connection.controller.abort();
    if (current === connection)
      current = undefined;
  }
  async function run(connection) {
    let iterator;
    let completion = {};
    try {
      if (connection.controller.signal.aborted)
        return;
      iterator = connect(connection.controller.signal, () => {
        connection.subscribers.forEach((subscriber) => subscriber.activity?.());
      })[Symbol.asyncIterator]();
      while (!connection.controller.signal.aborted) {
        const item = await iterator.next();
        if (item.done || connection.controller.signal.aborted)
          break;
        if (item.value.type === "server.connected")
          connection.connected = item.value;
        connection.subscribers.forEach((subscriber) => subscriber.push(item.value));
      }
    } catch (error) {
      completion = { error };
    } finally {
      stop(connection);
      try {
        await iterator?.return?.();
      } catch (error) {
        if (!("error" in completion))
          completion = { error };
      }
      connection.subscribers.forEach((subscriber) => subscriber.finish(completion));
    }
  }
  return {
    subscribe(options) {
      return {
        [Symbol.asyncIterator]() {
          const pending = [];
          const queued = [];
          let started = false;
          let completion;
          let connection;
          const types = options?.types?.length ? new Set(options.types) : undefined;
          const selected = (value) => !types || value.type === "server.connected" || types.has(value.type);
          function finish(result, discard = true) {
            completion = result;
            if (discard)
              queued.length = 0;
            options?.signal?.removeEventListener("abort", abort);
            if (connection?.subscribers.delete(subscriber) && !connection.subscribers.size)
              stop(connection);
            pending.splice(0).forEach((request) => {
              if ("error" in result)
                request.reject(result.error);
              else
                request.resolve({ done: true, value: undefined });
            });
          }
          function abort() {
            finish({});
          }
          const subscriber = {
            activity: options?.onActivity,
            finish(result) {
              finish(result, false);
            },
            push(value) {
              if (completion)
                return;
              if (!selected(value))
                return;
              const request = pending.shift();
              if (request) {
                request.resolve({ done: false, value });
                return;
              }
              if (queued.length === capacity) {
                finish({ error: new Error(`Event subscriber exceeded its ${capacity}-event capacity`) });
                return;
              }
              queued.push(value);
            }
          };
          function start() {
            if (completion)
              return;
            const fresh = !current;
            connection = current ?? {
              controller: new AbortController,
              subscribers: new Set
            };
            current = connection;
            connection.subscribers.add(subscriber);
            if (connection.connected)
              subscriber.push(connection.connected);
            if (fresh)
              run(connection);
          }
          return {
            next() {
              const value = queued.shift();
              if (value)
                return Promise.resolve({ done: false, value });
              if (completion) {
                if ("error" in completion)
                  return Promise.reject(completion.error);
                return Promise.resolve({ done: true, value: undefined });
              }
              if (options?.signal?.aborted) {
                abort();
                return Promise.resolve({ done: true, value: undefined });
              }
              const request = Promise.withResolvers();
              pending.push(request);
              if (!started) {
                started = true;
                options?.signal?.addEventListener("abort", abort, { once: true });
                start();
              }
              return request.promise;
            },
            return() {
              finish({});
              return Promise.resolve({ done: true, value: undefined });
            }
          };
        }
      };
    }
  };
}

// node_modules/@opencode/client/dist/chunks/contract-nwcpakzx.js
class ClientError3 extends Error {
  reason;
  name = "ClientError";
  constructor(reason, options) {
    const detail = options?.detail ?? (options?.cause instanceof Error ? options.cause.message : undefined);
    super(detail ? `${reason}: ${detail}` : reason, options);
    this.reason = reason;
  }
}

// node_modules/@opencode/client/dist/chunks/contract-qdgaygb4.js
var exports_client4 = {};
__export(exports_client4, {
  make: () => make6
});
var maxSseEventBytes = 16 * 1024 * 1024;
function make6(options) {
  const fetch2 = options.fetch ?? globalThis.fetch;
  const prepare = (descriptor, requestOptions) => {
    const baseUrl = new URL(options.baseUrl);
    if (!baseUrl.pathname.endsWith("/"))
      baseUrl.pathname += "/";
    const url = new URL(descriptor.path.slice(1), baseUrl);
    for (const [key, value] of Object.entries(descriptor.query ?? {}))
      appendQuery(url.searchParams, key, value);
    const headers = new Headers(options.headers);
    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== undefined && value !== null)
        headers.set(key, String(value));
    }
    for (const [key, value] of new Headers(requestOptions?.headers))
      headers.set(key, value);
    if (descriptor.body !== undefined && !headers.has("content-type"))
      headers.set("content-type", descriptor.binaryBody ? "application/octet-stream" : "application/json");
    return {
      url,
      init: {
        method: descriptor.method,
        signal: requestOptions?.signal,
        headers,
        body: descriptor.body === undefined ? undefined : descriptor.binaryBody ? descriptor.body : JSON.stringify(descriptor.body)
      }
    };
  };
  const execute = async (descriptor, requestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions);
      return await fetch2(prepared.url, prepared.init);
    } catch (cause) {
      throw new ClientError3("Transport", { cause });
    }
  };
  const responseError = async (response, descriptor) => {
    if (descriptor.declaredStatuses.includes(response.status))
      throw declared(await json(response));
    try {
      await response.body?.cancel();
    } catch {}
    throw new ClientError3("UnexpectedStatus", { cause: { status: response.status }, detail: String(response.status) });
  };
  const request = async (descriptor, requestOptions) => {
    const response = await execute(descriptor, requestOptions);
    if (response.status !== descriptor.successStatus)
      return responseError(response, descriptor);
    if (descriptor.binary)
      return new Uint8Array(await response.arrayBuffer());
    if (descriptor.empty) {
      try {
        await response.body?.cancel();
      } catch {}
      return;
    }
    return await json(response);
  };
  const sse = (descriptor, requestOptions) => ({
    async* [Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions);
      if (response.status !== descriptor.successStatus)
        await responseError(response, descriptor);
      if (!isContentType(response, "text/event-stream")) {
        try {
          await response.body?.cancel();
        } catch {}
        throw new ClientError3("UnsupportedContentType", { detail: response.headers.get("content-type") });
      }
      if (response.body === null)
        throw new ClientError3("MalformedResponse");
      const reader = response.body.getReader();
      const decoder = new TextDecoder;
      let buffer = "";
      try {
        while (true) {
          let next;
          try {
            next = await reader.read();
          } catch (cause) {
            throw new ClientError3("Transport", { cause });
          }
          if (!next.done)
            requestOptions?.onActivity?.();
          buffer += decoder.decode(next.value, { stream: !next.done });
          if (buffer.length > maxSseEventBytes)
            throw new ClientError3("SseEventTooLarge");
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r");
          if (trailingCarriageReturn)
            buffer = buffer.slice(0, -1);
          buffer = buffer.replaceAll(`\r
`, `
`).replaceAll("\r", `
`);
          if (trailingCarriageReturn)
            buffer += "\r";
          if (next.done && buffer !== "")
            buffer += `

`;
          let boundary = buffer.indexOf(`

`);
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block.split(`
`).flatMap((line) => line.startsWith("data:") ? [line.slice(5).trimStart()] : []).join(`
`);
            if (data !== "") {
              try {
                yield JSON.parse(data);
              } catch (cause) {
                throw new ClientError3("MalformedResponse", { cause });
              }
            }
            boundary = buffer.indexOf(`

`);
          }
          if (next.done)
            return;
        }
      } finally {
        try {
          await reader.cancel();
        } catch {}
        reader.releaseLock();
      }
    }
  });
  const client = {
    server: {
      info: (requestOptions) => request({ method: "GET", path: `/api/info`, successStatus: 200, declaredStatuses: [400, 401], empty: false }, requestOptions),
      pair: (requestOptions) => request({ method: "POST", path: `/api/pair`, successStatus: 200, declaredStatuses: [400, 401], empty: false }, requestOptions),
      connect: (input, requestOptions) => request({
        method: "GET",
        path: `/auth/connect/${encodeURIComponent(input.code)}`,
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions)
    },
    location: {
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/location`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      reload: (requestOptions) => request({
        method: "POST",
        path: `/api/location/reload`,
        successStatus: 204,
        declaredStatuses: [400, 401, 503],
        empty: true
      }, requestOptions)
    },
    agent: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/agent`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/agent/${encodeURIComponent(input.agentID)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions)
    },
    plugin: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/plugin`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      gui: (input, requestOptions) => request({
        method: "GET",
        path: `/api/plugin/gui`,
        query: { location: input["location"], id: input["id"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      check: (input, requestOptions) => request({
        method: "POST",
        path: `/api/plugin/check`,
        query: { location: input?.["location"] },
        body: { target: input?.["target"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      update: (input, requestOptions) => request({
        method: "POST",
        path: `/api/plugin/update`,
        query: { location: input["location"] },
        body: { targets: input["targets"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404, 503],
        empty: true
      }, requestOptions)
    },
    session: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session`,
        query: {
          limit: input?.["limit"],
          order: input?.["order"],
          search: input?.["search"],
          parentID: input?.["parentID"],
          archived: input?.["archived"],
          directory: input?.["directory"],
          project: input?.["project"],
          subpath: input?.["subpath"],
          cursor: input?.["cursor"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      create: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session`,
        body: {
          id: input?.["id"],
          parentID: input?.["parentID"],
          title: input?.["title"],
          agent: input?.["agent"],
          model: input?.["model"],
          location: input?.["location"],
          metadata: input?.["metadata"],
          permissions: input?.["permissions"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions).then((value) => value.data),
      active: (requestOptions) => request({
        method: "GET",
        path: `/api/session/active`,
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions).then((value) => value.data),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}`,
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions).then((value) => value.data),
      remove: (input, requestOptions) => request({
        method: "DELETE",
        path: `/api/session/${encodeURIComponent(input.sessionID)}`,
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      fork: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/fork`,
        body: { before: input["before"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions).then((value) => value.data),
      switchAgent: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/agent`,
        body: { agent: input["agent"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      switchModel: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/model`,
        body: { model: input["model"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      update: (input, requestOptions) => request({
        method: "PATCH",
        path: `/api/session/${encodeURIComponent(input.sessionID)}`,
        body: {
          title: input["title"],
          metadata: input["metadata"],
          permissions: input["permissions"],
          archived: input["archived"]
        },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      move: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/move`,
        body: { directory: input["directory"], delivery: input["delivery"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      prompt: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/prompt`,
        body: {
          id: input["id"],
          text: input["text"],
          files: input["files"],
          agents: input["agents"],
          skills: input["skills"],
          metadata: input["metadata"],
          delivery: input["delivery"],
          resume: input["resume"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 409],
        empty: false
      }, requestOptions).then((value) => value.data),
      command: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/command`,
        body: {
          name: input["name"],
          text: input["text"],
          files: input["files"],
          agents: input["agents"],
          skills: input["skills"],
          delivery: input["delivery"]
        },
        successStatus: 204,
        declaredStatuses: [400, 401, 404, 500],
        empty: true
      }, requestOptions),
      synthetic: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/synthetic`,
        body: {
          id: input["id"],
          text: input["text"],
          description: input["description"],
          metadata: input["metadata"],
          delivery: input["delivery"],
          resume: input["resume"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 409],
        empty: false
      }, requestOptions).then((value) => value.data),
      shell: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/shell`,
        body: { id: input["id"], command: input["command"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      compact: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/compact`,
        body: { id: input["id"], delivery: input["delivery"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 409],
        empty: false
      }, requestOptions).then((value) => value.data),
      revert: {
        stage: (input, requestOptions) => request({
          method: "POST",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/stage`,
          body: { messageID: input["messageID"], files: input["files"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 409, 500],
          empty: false
        }, requestOptions).then((value) => value.data),
        clear: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/revert`,
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 409, 500],
          empty: true
        }, requestOptions),
        commit: (input, requestOptions) => request({
          method: "POST",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/commit`,
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 409],
          empty: true
        }, requestOptions)
      },
      context: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/context`,
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 500],
        empty: false
      }, requestOptions).then((value) => value.data),
      diff: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/diff`,
        query: { from: input["from"], to: input["to"], context: input["context"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 500],
        empty: false
      }, requestOptions).then((value) => value.data),
      inbox: {
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/inbox`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        cancel: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/inbox/${encodeURIComponent(input.inboxID)}`,
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions),
        update: (input, requestOptions) => request({
          method: "PATCH",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/inbox/${encodeURIComponent(input.inboxID)}`,
          body: { delivery: input["delivery"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 409],
          empty: true
        }, requestOptions)
      },
      generate: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/generate`,
        body: { prompt: input["prompt"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 503],
        empty: false
      }, requestOptions).then((value) => value.data),
      interrupt: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/interrupt`,
        query: { resume: input["resume"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      background: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/background`,
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      message: {
        get: (input, requestOptions) => request({
          method: "GET",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions).then((value) => value.data)
      },
      form: {
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/form`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        create: (input, requestOptions) => request({
          method: "POST",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/form`,
          body: { id: input["id"], title: input["title"], metadata: input["metadata"], fields: input["fields"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 409],
          empty: false
        }, requestOptions).then((value) => value.data),
        get: (input, requestOptions) => request({
          method: "GET",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        reply: (input, requestOptions) => request({
          method: "POST",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}/reply`,
          body: { answer: input["answer"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 409],
          empty: true
        }, requestOptions),
        cancel: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}`,
          query: { message: input["message"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 409],
          empty: true
        }, requestOptions)
      },
      environment: (input, requestOptions) => request({
        method: "PUT",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/environment`,
        body: { variables: input["variables"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      view: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/view`,
        body: { idle: input["idle"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions)
    },
    experimental: {
      session: {
        stats: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/session/stats`,
          query: {
            from: input?.["from"],
            to: input?.["to"],
            project: input?.["project"],
            timezone: input?.["timezone"],
            tools: input?.["tools"]
          },
          successStatus: 200,
          declaredStatuses: [400, 401],
          empty: false
        }, requestOptions).then((value) => value.data),
        import: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/session/import`,
          body: { info: input["info"], messages: input["messages"], location: input["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 409],
          empty: false
        }, requestOptions).then((value) => value.data),
        export: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/export`,
          query: { sanitize: input["sanitize"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 500],
          empty: false
        }, requestOptions).then((value) => value.data),
        skill: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/skill`,
          body: { id: input["id"], resume: input["resume"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions),
        wait: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/wait`,
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 503],
          empty: true
        }, requestOptions),
        instructions: {
          entry: {
            list: (input, requestOptions) => request({
              method: "GET",
              path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/instructions/entries`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false
            }, requestOptions).then((value) => value.data),
            put: (input, requestOptions) => request({
              method: "PUT",
              path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/instructions/entries/${encodeURIComponent(input.key)}`,
              body: { value: input["value"] },
              successStatus: 204,
              declaredStatuses: [400, 401, 404, 413],
              empty: true
            }, requestOptions),
            remove: (input, requestOptions) => request({
              method: "DELETE",
              path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/instructions/entries/${encodeURIComponent(input.key)}`,
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true
            }, requestOptions)
          }
        },
        log: (input, requestOptions) => sse({
          method: "GET",
          path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/log`,
          query: { after: input["after"], follow: input["follow"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions)
      },
      generate: {
        text: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/generate/text`,
          body: { prompt: input["prompt"], model: input["model"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 422, 502, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        image: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/generate/image`,
          body: {
            model: input["model"],
            prompt: input["prompt"],
            images: input["images"],
            n: input["n"],
            aspect: input["aspect"],
            resolution: input["resolution"]
          },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 422, 502, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        decisions: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/generate/decisions`,
          body: { model: input["model"], input: input["input"], questions: input["questions"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 422, 502, 503],
          empty: false
        }, requestOptions).then((value) => value.data)
      },
      voice: {
        models: (requestOptions) => request({
          method: "GET",
          path: `/api/experimental/voice/models`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        session: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/voice/session`,
          body: { model: input["model"], session: input["session"], transport: input["transport"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 503],
          empty: false
        }, requestOptions).then((value) => value.data)
      },
      integration: {
        wellknown: {
          add: (input, requestOptions) => request({
            method: "POST",
            path: `/api/experimental/integration/wellknown`,
            query: { location: input["location"] },
            body: { url: input["url"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true
          }, requestOptions)
        }
      },
      mcp: {
        add: (input, requestOptions) => request({
          method: "PUT",
          path: `/api/experimental/mcp/${encodeURIComponent(input.server)}`,
          query: { location: input["location"] },
          body: { config: input["config"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions),
        remove: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/experimental/mcp/${encodeURIComponent(input.server)}`,
          query: { location: input["location"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions),
        connect: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/mcp/${encodeURIComponent(input.server)}/connect`,
          query: { location: input["location"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions),
        disconnect: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/mcp/${encodeURIComponent(input.server)}/disconnect`,
          query: { location: input["location"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions),
        client: {
          token: (input, requestOptions) => request({
            method: "POST",
            path: `/api/experimental/client-mcp/token`,
            query: { location: input["location"], name: input["name"] },
            headers: { "x-opencode-ticket": input["x-opencode-ticket"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404],
            empty: false
          }, requestOptions)
        }
      },
      file: {
        write: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/fs/write`,
          query: { location: input["location"], path: input["path"] },
          body: input["payload"],
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false,
          binaryBody: true
        }, requestOptions),
        watch: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/fs/watch`,
          query: { location: input["location"] },
          body: { path: input["path"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 503],
          empty: true
        }, requestOptions),
        unwatch: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/experimental/fs/watch`,
          query: { location: input["location"] },
          body: { path: input["path"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions)
      },
      persistentPty: {
        read: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/terminal/read`,
          query: { lines: input["lines"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/terminal`,
          successStatus: 200,
          declaredStatuses: [400, 401, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        create: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/terminal`,
          body: {
            command: input["command"],
            args: input["args"],
            cwd: input["cwd"],
            title: input["title"],
            env: input["env"],
            size: input["size"]
          },
          successStatus: 200,
          declaredStatuses: [400, 401, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        shutdown: (requestOptions) => request({
          method: "POST",
          path: `/api/experimental/persistent-pty/shutdown`,
          successStatus: 204,
          declaredStatuses: [400, 401, 503],
          empty: true
        }, requestOptions),
        handoff: (requestOptions) => request({
          method: "POST",
          path: `/api/experimental/persistent-pty/handoff`,
          successStatus: 200,
          declaredStatuses: [400, 401, 503],
          empty: false
        }, requestOptions),
        get: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        update: (input, requestOptions) => request({
          method: "PUT",
          path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}`,
          body: { attachmentID: input["attachmentID"], size: input["size"], title: input["title"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 501, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        snapshot: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}/snapshot`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 503],
          empty: false
        }, requestOptions).then((value) => value.data),
        remove: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}`,
          successStatus: 204,
          declaredStatuses: [400, 401, 404, 503],
          empty: true
        }, requestOptions),
        connectToken: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}/connect-token`,
          headers: { "x-opencode-ticket": input["x-opencode-ticket"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404, 503],
          empty: false
        }, requestOptions).then((value) => value.data)
      },
      media: {
        get: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/media/${encodeURIComponent(input.hash)}`,
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false,
          binary: true
        }, requestOptions)
      },
      schedule: {
        create: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/schedule`,
          body: {
            sessionID: input["sessionID"],
            name: input["name"],
            when: input["when"],
            if: input["if"],
            until: input["until"],
            ends: input["ends"],
            prompt: input["prompt"]
          },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/schedule`,
          query: { sessionID: input["sessionID"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        get: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/schedule/${encodeURIComponent(input.scheduleID)}`,
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        pause: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/schedule/${encodeURIComponent(input.scheduleID)}/pause`,
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        resume: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/schedule/${encodeURIComponent(input.scheduleID)}/resume`,
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        delete: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/experimental/schedule/${encodeURIComponent(input.scheduleID)}`,
          successStatus: 204,
          declaredStatuses: [400, 401, 403, 404],
          empty: true
        }, requestOptions)
      },
      artifacts: {
        providers: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/artifacts/providers`,
          query: { location: input?.["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404, 503],
          empty: false
        }, requestOptions),
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/artifacts`,
          query: { location: input?.["location"], sessionID: input?.["sessionID"], provider: input?.["provider"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404, 503],
          empty: false
        }, requestOptions),
        create: (input, requestOptions) => request({
          method: "POST",
          path: `/api/experimental/artifacts`,
          query: { location: input["location"] },
          body: {
            title: input["title"],
            files: input["files"],
            entry: input["entry"],
            provider: input["provider"],
            sessionID: input["sessionID"]
          },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404, 503],
          empty: false
        }, requestOptions),
        get: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/artifacts/${encodeURIComponent(input.artifactID)}`,
          query: { location: input["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404, 503],
          empty: false
        }, requestOptions),
        update: (input, requestOptions) => request({
          method: "PATCH",
          path: `/api/experimental/artifacts/${encodeURIComponent(input.artifactID)}`,
          query: { location: input["location"] },
          body: {
            title: input["title"],
            files: input["files"],
            entry: input["entry"],
            sessionID: input["sessionID"]
          },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404, 503],
          empty: false
        }, requestOptions),
        delete: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/experimental/artifacts/${encodeURIComponent(input.artifactID)}`,
          query: { location: input["location"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 403, 404, 503],
          empty: true
        }, requestOptions),
        view: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/artifacts/${encodeURIComponent(input.artifactID)}/view/${encodePath(input.path)}`,
          query: { location: input["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404, 503],
          empty: false,
          binary: true
        }, requestOptions)
      },
      job: {
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/job`,
          query: {
            sessionID: input?.["sessionID"],
            kind: input?.["kind"],
            status: input?.["status"],
            descendants: input?.["descendants"]
          },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions).then((value) => value.data)
      },
      migration: {
        v1: {
          status: (requestOptions) => request({
            method: "GET",
            path: `/api/experimental/migration/v1`,
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false
          }, requestOptions)
        }
      },
      usage: {
        limits: (input, requestOptions) => request({
          method: "GET",
          path: `/api/experimental/usage/limits`,
          query: { location: input?.["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 503],
          empty: false
        }, requestOptions)
      },
      config: {
        update: (input, requestOptions) => request({
          method: "PATCH",
          path: `/api/experimental/config`,
          body: { shell: input["shell"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions)
      }
    },
    message: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/message`,
        query: { limit: input["limit"], order: input["order"], cursor: input["cursor"], type: input["type"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 500],
        empty: false
      }, requestOptions)
    },
    model: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/model`,
        query: { location: input?.["location"], types: input?.["types"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 503],
        empty: false
      }, requestOptions),
      default: (input, requestOptions) => request({
        method: "GET",
        path: `/api/model/default`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 503],
        empty: false
      }, requestOptions)
    },
    provider: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/provider`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 503],
        empty: false
      }, requestOptions),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/provider/${encodeURIComponent(input.providerID)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 503],
        empty: false
      }, requestOptions)
    },
    integration: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/integration`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/integration/${encodeURIComponent(input.integrationID)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      connect: {
        key: (input, requestOptions) => request({
          method: "POST",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/key`,
          query: { location: input["location"] },
          body: { key: input["key"], answer: input["answer"], label: input["label"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions),
        external: (input, requestOptions) => request({
          method: "POST",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/external`,
          query: { location: input["location"] },
          body: { methodID: input["methodID"], answer: input["answer"], label: input["label"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions)
      },
      oauth: {
        connect: (input, requestOptions) => request({
          method: "POST",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth`,
          query: { location: input["location"] },
          body: { methodID: input["methodID"], answer: input["answer"], label: input["label"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions),
        status: (input, requestOptions) => request({
          method: "GET",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}`,
          query: { location: input["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions),
        complete: (input, requestOptions) => request({
          method: "POST",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}/complete`,
          query: { location: input["location"] },
          body: { code: input["code"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions),
        cancel: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}`,
          query: { location: input["location"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions)
      },
      command: {
        connect: (input, requestOptions) => request({
          method: "POST",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command`,
          query: { location: input["location"] },
          body: { methodID: input["methodID"], label: input["label"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions),
        status: (input, requestOptions) => request({
          method: "GET",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command/${encodeURIComponent(input.attemptID)}`,
          query: { location: input["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions),
        cancel: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command/${encodeURIComponent(input.attemptID)}`,
          query: { location: input["location"] },
          successStatus: 204,
          declaredStatuses: [400, 401, 404],
          empty: true
        }, requestOptions)
      }
    },
    mcp: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/mcp`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      resource: {
        catalog: (input, requestOptions) => request({
          method: "GET",
          path: `/api/mcp/resource`,
          query: { location: input?.["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions)
      }
    },
    credential: {
      list: (requestOptions) => request({ method: "GET", path: `/api/credential`, successStatus: 200, declaredStatuses: [400, 401], empty: false }, requestOptions).then((value) => value.data),
      create: (input, requestOptions) => request({
        method: "POST",
        path: `/api/credential`,
        body: {
          id: input["id"],
          integrationID: input["integrationID"],
          label: input["label"],
          value: input["value"],
          activate: input["activate"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 409],
        empty: false
      }, requestOptions).then((value) => value.data),
      update: (input, requestOptions) => request({
        method: "PATCH",
        path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
        body: { label: input["label"] },
        successStatus: 204,
        declaredStatuses: [400, 401],
        empty: true
      }, requestOptions),
      activate: (input, requestOptions) => request({
        method: "POST",
        path: `/api/credential/${encodeURIComponent(input.credentialID)}/activate`,
        successStatus: 204,
        declaredStatuses: [400, 401],
        empty: true
      }, requestOptions),
      remove: (input, requestOptions) => request({
        method: "DELETE",
        path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
        successStatus: 204,
        declaredStatuses: [400, 401],
        empty: true
      }, requestOptions)
    },
    project: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/project`,
        query: { archived: input?.["archived"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions),
      update: (input, requestOptions) => request({
        method: "PATCH",
        path: `/api/project/${encodeURIComponent(input.projectID)}`,
        body: {
          canonical: input["canonical"],
          name: input["name"],
          icon: input["icon"],
          commands: input["commands"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions)
    },
    form: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/form`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions)
    },
    permission: {
      request: {
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/permission/request`,
          query: { location: input?.["location"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions)
      },
      saved: {
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/permission/saved`,
          query: { projectID: input?.["projectID"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions).then((value) => value.data),
        update: (input, requestOptions) => request({
          method: "PATCH",
          path: `/api/permission/saved/${encodeURIComponent(input.id)}`,
          body: { action: input["action"], resource: input["resource"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404, 409],
          empty: false
        }, requestOptions).then((value) => value.data),
        remove: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/permission/saved/${encodeURIComponent(input.id)}`,
          successStatus: 204,
          declaredStatuses: [400, 401],
          empty: true
        }, requestOptions)
      },
      create: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
        body: {
          id: input["id"],
          action: input["action"],
          resources: input["resources"],
          save: input["save"],
          metadata: input["metadata"],
          source: input["source"],
          agent: input["agent"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions).then((value) => value.data),
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions).then((value) => value.data),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}`,
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions).then((value) => value.data),
      reply: (input, requestOptions) => request({
        method: "POST",
        path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}/reply`,
        body: { decision: input["decision"], message: input["message"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions)
    },
    file: {
      read: (input, requestOptions) => request({
        method: "GET",
        path: `/api/fs/read/${encodePath(input.path)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false,
        binary: true
      }, requestOptions),
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/fs/list`,
        query: { location: input?.["location"], path: input?.["path"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      find: (input, requestOptions) => request({
        method: "GET",
        path: `/api/fs/find`,
        query: { location: input["location"], query: input["query"], type: input["type"], limit: input["limit"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions)
    },
    command: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/command`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions)
    },
    skill: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/skill`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions)
    },
    rpc: {
      call: (input, requestOptions) => request({
        method: "POST",
        path: `/api/rpc/${encodeURIComponent(input.rpcID)}/${encodeURIComponent(input.method)}`,
        query: { location: input["location"] },
        body: { input: input["input"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 500],
        empty: false
      }, requestOptions)
    },
    event: {
      subscribe: (input, requestOptions) => sse({
        method: "GET",
        path: `/api/event`,
        query: { types: input?.["types"] },
        successStatus: 200,
        declaredStatuses: [400, 401],
        empty: false
      }, requestOptions)
    },
    pty: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/pty`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      create: (input, requestOptions) => request({
        method: "POST",
        path: `/api/pty`,
        query: { location: input?.["location"] },
        body: {
          command: input?.["command"],
          args: input?.["args"],
          cwd: input?.["cwd"],
          title: input?.["title"],
          env: input?.["env"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      update: (input, requestOptions) => request({
        method: "PUT",
        path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
        query: { location: input["location"] },
        body: { title: input["title"], size: input["size"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      remove: (input, requestOptions) => request({
        method: "DELETE",
        path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
        query: { location: input["location"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      connect: {
        token: (input, requestOptions) => request({
          method: "POST",
          path: `/api/pty/${encodeURIComponent(input.ptyID)}/connect-token`,
          query: { location: input["location"] },
          headers: { "x-opencode-ticket": input["x-opencode-ticket"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 403, 404],
          empty: false
        }, requestOptions)
      }
    },
    shell: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/shell`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      create: (input, requestOptions) => request({
        method: "POST",
        path: `/api/shell`,
        query: { location: input["location"] },
        body: {
          command: input["command"],
          cwd: input["cwd"],
          timeout: input["timeout"],
          metadata: input["metadata"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/shell/${encodeURIComponent(input.id)}`,
        query: { location: input["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      output: (input, requestOptions) => request({
        method: "GET",
        path: `/api/shell/${encodeURIComponent(input.id)}/output`,
        query: { location: input["location"], cursor: input["cursor"], limit: input["limit"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      remove: (input, requestOptions) => request({
        method: "DELETE",
        path: `/api/shell/${encodeURIComponent(input.id)}`,
        query: { location: input["location"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions)
    },
    reference: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/reference`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions)
    },
    worktree: {
      list: (input, requestOptions) => request({
        method: "GET",
        path: `/api/worktree`,
        query: { projectID: input["projectID"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      create: (input, requestOptions) => request({
        method: "POST",
        path: `/api/worktree`,
        body: {
          projectID: input["projectID"],
          from: input["from"],
          branch: input["branch"],
          directory: input["directory"],
          name: input["name"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      remove: (input, requestOptions) => request({
        method: "DELETE",
        path: `/api/worktree`,
        body: { projectID: input["projectID"], directory: input["directory"], force: input["force"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions),
      refresh: (input, requestOptions) => request({
        method: "POST",
        path: `/api/worktree/refresh`,
        body: { projectID: input["projectID"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404],
        empty: true
      }, requestOptions)
    },
    vcs: {
      init: (input, requestOptions) => request({
        method: "POST",
        path: `/api/vcs/init`,
        query: { location: input?.["location"], provider: input?.["provider"] },
        successStatus: 204,
        declaredStatuses: [400, 401, 404, 409, 501, 503],
        empty: true
      }, requestOptions),
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/vcs`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      base: (input, requestOptions) => request({
        method: "GET",
        path: `/api/vcs/base`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 503],
        empty: false
      }, requestOptions),
      status: (input, requestOptions) => request({
        method: "GET",
        path: `/api/vcs/status`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      branch: {
        list: (input, requestOptions) => request({
          method: "GET",
          path: `/api/vcs/branch`,
          query: { location: input?.["location"], search: input?.["search"], limit: input?.["limit"] },
          successStatus: 200,
          declaredStatuses: [400, 401, 404],
          empty: false
        }, requestOptions)
      },
      diff: (input, requestOptions) => request({
        method: "GET",
        path: `/api/vcs/diff`,
        query: {
          location: input["location"],
          mode: input["mode"],
          base: input["base"],
          context: input["context"],
          untracked: input["untracked"]
        },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 503],
        empty: false
      }, requestOptions)
    },
    debug: {
      heapDump: (input, requestOptions) => request({
        method: "POST",
        path: `/api/debug/heap-dump`,
        query: { directory: input?.["directory"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 500],
        empty: false
      }, requestOptions),
      location: {
        list: (requestOptions) => request({
          method: "GET",
          path: `/api/debug/location`,
          successStatus: 200,
          declaredStatuses: [400, 401],
          empty: false
        }, requestOptions),
        evict: (input, requestOptions) => request({
          method: "DELETE",
          path: `/api/debug/location`,
          query: { location: input?.["location"] },
          successStatus: 204,
          declaredStatuses: [400, 401],
          empty: true
        }, requestOptions)
      }
    },
    websearch: {
      providers: (input, requestOptions) => request({
        method: "GET",
        path: `/api/websearch/provider`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 503],
        empty: false
      }, requestOptions),
      query: (input, requestOptions) => request({
        method: "POST",
        path: `/api/websearch`,
        query: { location: input["location"] },
        body: { query: input["query"], providerID: input["providerID"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404, 503],
        empty: false
      }, requestOptions)
    },
    config: {
      get: (input, requestOptions) => request({
        method: "GET",
        path: `/api/config`,
        query: { location: input?.["location"] },
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions),
      shells: (requestOptions) => request({
        method: "GET",
        path: `/api/config/shell`,
        successStatus: 200,
        declaredStatuses: [400, 401, 404],
        empty: false
      }, requestOptions)
    }
  };
  return {
    ...client,
    session: {
      ...client.session,
      stats: client.experimental.session.stats,
      import: client.experimental.session.import,
      export: client.experimental.session.export,
      skill: client.experimental.session.skill,
      wait: client.experimental.session.wait,
      instructions: {
        entry: {
          list: client.experimental.session.instructions.entry.list,
          put: client.experimental.session.instructions.entry.put,
          remove: client.experimental.session.instructions.entry.remove
        }
      },
      log: client.experimental.session.log
    },
    generate: {
      text: client.experimental.generate.text,
      image: client.experimental.generate.image,
      decisions: client.experimental.generate.decisions
    },
    voice: {
      models: client.experimental.voice.models,
      session: client.experimental.voice.session
    },
    integration: {
      ...client.integration,
      wellknown: {
        add: client.experimental.integration.wellknown.add
      }
    },
    mcp: {
      ...client.mcp,
      add: client.experimental.mcp.add,
      remove: client.experimental.mcp.remove,
      connect: client.experimental.mcp.connect,
      disconnect: client.experimental.mcp.disconnect,
      client: {
        token: client.experimental.mcp.client.token
      }
    },
    file: {
      ...client.file,
      write: client.experimental.file.write,
      watch: client.experimental.file.watch,
      unwatch: client.experimental.file.unwatch
    },
    migration: {
      v1: {
        status: client.experimental.migration.v1.status
      }
    },
    usage: {
      limits: client.experimental.usage.limits
    },
    config: {
      ...client.config,
      update: client.experimental.config.update
    }
  };
}
function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}
function appendQuery(params, key, value) {
  if (value === undefined)
    return;
  if (value === null) {
    params.append(key, "null");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value)
      appendQuery(params, key, item);
    return;
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value))
      appendQuery(params, `${key}[${child}]`, item);
    return;
  }
  params.append(key, String(value));
}
async function json(response) {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel();
    } catch {}
    throw new ClientError3("UnsupportedContentType", { detail: response.headers.get("content-type") });
  }
  let text;
  try {
    text = await response.text();
  } catch (cause) {
    throw new ClientError3("Transport", { cause });
  }
  if (text === "")
    throw new ClientError3("MalformedResponse");
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ClientError3("MalformedResponse", { cause });
  }
}
function declared(body) {
  const error = Object.assign(new Error(body.message ?? body.data?.message), body);
  if (body._tag)
    error.name = body._tag;
  return error;
}
function isContentType(response, expected) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected;
}

// node_modules/@opencode/client/dist/chunks/contract-sdjh9vmn.js
var isRpcError2 = (value) => typeof value === "object" && value !== null && ("_tag" in value) && value["_tag"] === "RpcError";
var isRpcInternalError2 = (value) => typeof value === "object" && value !== null && ("_tag" in value) && value["_tag"] === "RpcInternalError";

// node_modules/@opencode/client/dist/chunks/contract-xqwq6bgr.js
function makeRpc2(raw, events) {
  return (definition) => {
    const subscribe = (name, options) => {
      if (!Object.hasOwn(definition.events, name))
        throw new Error(`Unknown RPC event: ${definition.id}.${name}`);
      const type = eventType(definition, name);
      return {
        [Symbol.asyncIterator]() {
          const controller = new AbortController;
          const signal = options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
          const iterator = async function* () {
            try {
              for await (const published of events.subscribe({ signal })) {
                if (signal.aborted)
                  return;
                if (published.type !== type)
                  continue;
                yield published;
              }
            } catch (error) {
              if (!signal.aborted)
                throw error;
            } finally {
              controller.abort();
            }
          }();
          return {
            next: () => iterator.next(),
            return: () => {
              controller.abort();
              return iterator.return();
            }
          };
        }
      };
    };
    return Object.assign(Object.fromEntries(Object.keys(definition.methods).map((name) => [
      name,
      async (input, options) => {
        try {
          const result = await raw.rpc.call({
            rpcID: definition.id,
            method: name,
            input,
            location: options?.location
          }, { signal: options?.signal, headers: options?.headers });
          return result.output;
        } catch (error) {
          if (!isRpcError2(error) && !isRpcInternalError2(error))
            throw error;
          throw error.data === undefined ? { type: error.type, message: error.message } : { type: error.type, message: error.message, data: error.data };
        }
      }
    ])), {
      events: {
        subscribe,
        on: (name, handler, options) => {
          const controller = new AbortController;
          const signal = options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
          const source = subscribe(name, { signal });
          (async () => {
            for await (const event of source)
              await handler(event);
          })().catch((error) => console.error(error));
          return () => controller.abort();
        }
      }
    });
  };
}
function eventType(definition, name) {
  return `rpc.${definition.id}.${name}`;
}

// node_modules/@opencode/client/dist/chunks/contract-b5ykzypt.js
var exports_client3 = {};
__export(exports_client3, {
  OpenCode: () => exports_client3,
  make: () => make5
});
function make5(options) {
  const raw = make6(options);
  const events = make7((signal, onActivity) => raw.event.subscribe(undefined, { signal, onActivity }));
  return {
    ...raw,
    rpc: Object.assign(makeRpc2(raw, events), raw.rpc),
    event: events
  };
}
// service/domain/opencode.ts
var MISSING = "__BOAT_OPENCODE_MISSING__";
var MARK = {
  status: "__BOAT_OPENCODE_STATUS__",
  password: "__BOAT_OPENCODE_PASSWORD__",
  home: "__BOAT_OPENCODE_HOME__",
  repos: "__BOAT_OPENCODE_REPOS__"
};
var MARKER_PATTERN = /__BOAT_OPENCODE_[A-Z]+__/;
var START_SCRIPT = [
  `command -v opencode >/dev/null 2>&1 || { echo ${MISSING}; exit 0; }`,
  "opencode service start >/dev/null 2>&1",
  `echo ${MARK.status}`,
  "opencode service status 2>&1",
  `echo ${MARK.password}`,
  "opencode service get password 2>&1",
  `echo ${MARK.home}`,
  "pwd",
  `echo ${MARK.repos}`,
  `for d in "$HOME"/*/; do [ -d "$d/.git" ] && printf '%s\\n' "\${d%/}"; done`,
  "exit 0"
].join(`
`);
var shellQuote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
var execScript = async (sandboxId, script) => {
  try {
    const data = await runBoat("exec", [sandboxId, "--timeout", "60", "--", script], { timeoutMs: 70000 });
    return isRecord(data) ? readString(data.stdout) ?? "" : "";
  } catch (failure) {
    if (failure instanceof BoatError && (failure.code === "missing-cli" || failure.code === "not-signed-in")) {
      throw failure;
    }
    throw new BoatError("command-failed", "boat exec could not run in that sandbox.");
  }
};
var readServicePort = (output) => {
  const match = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):(\d+)/.exec(output);
  const port = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
};
var readHostedUrl = (value) => {
  const url = isRecord(value) ? readString(value.url) : null;
  if (!url)
    return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:")
      return null;
    return { origin: parsed.origin, token: parsed.searchParams.get("_token") };
  } catch {
    return null;
  }
};
var readPairLink = (output, origin) => {
  for (const match of output.matchAll(/https?:\/\/\S+\/auth\/connect\/[\w-]+/g)) {
    if (match[0].startsWith(`${origin}/`))
      return match[0];
  }
  return null;
};
var section = (output, marker) => {
  const index = output.indexOf(marker);
  if (index < 0)
    return "";
  const rest = output.slice(index + marker.length);
  const next = rest.search(MARKER_PATTERN);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
};
var absoluteLines = (value) => value.split(/\r?\n/).flatMap((line) => {
  const path = line.trim();
  return path.startsWith("/") && !path.includes("\x00") ? [path] : [];
});
var sessionDirectories = (home, repos) => {
  const unique = [...new Set(repos)].sort();
  return [...new Set([...unique, home])];
};
var chooseSessionDirectory = (home, repos) => [...new Set(repos)].sort()[0] ?? home;
var readOpencodeService = (output) => {
  if (output.includes(MISSING))
    return null;
  const port = readServicePort(section(output, MARK.status));
  const password = section(output, MARK.password).split(/\r?\n/).map((line) => line.trim()).find((line) => /^[A-Za-z0-9_-]{8,200}$/.test(line)) ?? "";
  const home = absoluteLines(section(output, MARK.home))[0] ?? "";
  const repos = absoluteLines(section(output, MARK.repos)).filter((path) => path !== home);
  if (!port || !/^[A-Za-z0-9_-]{8,200}$/.test(password) || !home)
    return null;
  return {
    port,
    password,
    home,
    repos,
    directory: chooseSessionDirectory(home, repos),
    directories: sessionDirectories(home, repos)
  };
};
var ensureOpencodeService = async (sandboxId) => {
  const output = await execScript(sandboxId, START_SCRIPT);
  if (output.includes(MISSING))
    throw new Error("OpenCode is not installed in this sandbox.");
  const service = readOpencodeService(output);
  if (!service)
    throw new Error("OpenCode did not start in this sandbox.");
  return service;
};
var hostOpencode = async (sandboxId, port) => {
  let raw;
  try {
    raw = await runBoat("host", [sandboxId, String(port), "--localhost", "--title", "OpenCode"], { timeoutMs: 20000 });
  } catch (failure) {
    if (failure instanceof BoatError && (failure.code === "missing-cli" || failure.code === "not-signed-in")) {
      throw failure;
    }
    throw new BoatError("command-failed", "boat could not host the OpenCode port.");
  }
  const hosted = readHostedUrl(raw);
  if (!hosted)
    throw new Error("boat host returned no URL for OpenCode.");
  return { ...hosted, protected: isRecord(raw) && raw.isProtected === true };
};
var openOpencodeUrl = async (sandboxId) => {
  const service = await ensureOpencodeService(sandboxId);
  const hosted = await hostOpencode(sandboxId, service.port);
  const pairing = await execScript(sandboxId, `opencode pair --url ${shellQuote(hosted.origin)} 2>&1`);
  const link = readPairLink(pairing, hosted.origin);
  if (!link)
    throw new Error("OpenCode did not print a sign-in link.");
  if (!hosted.token)
    return link;
  const url = new URL(link);
  url.searchParams.set("_token", hosted.token);
  return url.toString();
};

// service/opencode/connection.ts
var DEFAULT_TTL_MS = 30 * 60000;
var build = async (sandboxId) => {
  const service = await ensureOpencodeService(sandboxId);
  const hosted = await hostOpencode(sandboxId, service.port);
  if (hosted.protected && !hosted.token) {
    throw new Error("boat returned no access token for the OpenCode port.");
  }
  const headers = {
    Authorization: `Basic ${Buffer.from(`opencode:${service.password}`, "utf8").toString("base64")}`
  };
  if (hosted.token)
    headers.Cookie = `_port_auth=${hosted.token}`;
  return {
    sandboxId,
    client: exports_client3.make({ baseUrl: hosted.origin, headers }),
    home: service.home,
    directory: service.directory,
    directories: service.directories
  };
};
var messageOf = (failure) => {
  if (failure instanceof Error && failure.message.trim())
    return failure.message;
  if (!isRecord(failure))
    return null;
  const direct = readString(failure.message);
  if (direct)
    return direct;
  const data = isRecord(failure.data) ? failure.data : null;
  return readString(data?.message);
};
var isReconnectableFailure = (failure) => {
  if (isRecord(failure) && readString(failure._tag) === "UnauthorizedError")
    return true;
  if (failure instanceof Error && failure.name === "ClientError") {
    const reason = failure.reason;
    if (reason === "Transport")
      return true;
    return reason === "UnexpectedStatus" && /\b40[13]\b/.test(failure.message);
  }
  return false;
};
var CLIENT_FAILURE = {
  Transport: "The OpenCode server in that sandbox did not answer.",
  UnexpectedStatus: "The OpenCode server refused the request.",
  UnsupportedContentType: "OpenCode returned an unexpected answer.",
  MalformedResponse: "OpenCode returned an unexpected answer.",
  SseEventTooLarge: "OpenCode sent an event that was too large to read."
};
var DECLARED_FAILURE = {
  UnauthorizedError: "OpenCode refused this service's credentials.",
  SessionNotFoundError: "That OpenCode session no longer exists.",
  LocationNotFoundError: "OpenCode does not know that directory.",
  SessionBusyError: "That OpenCode session is busy; wait for it to finish.",
  PermissionNotFoundError: "That permission request is no longer waiting.",
  FormNotFoundError: "That question is no longer waiting.",
  FormAlreadySettledError: "That question was already answered."
};
var describeOpencodeError = (failure) => {
  if (failure instanceof BoatError)
    return failure;
  if (failure instanceof Error && failure.name === "ClientError") {
    const reason = failure.reason;
    const text = typeof reason === "string" ? CLIENT_FAILURE[reason] : null;
    if (text)
      return new Error(text);
  }
  const tag = isRecord(failure) ? readString(failure._tag) : null;
  if (tag) {
    const text = DECLARED_FAILURE[tag] ?? (tag === "FormInvalidAnswerError" ? messageOf(failure) : null);
    if (text)
      return new Error(text);
  }
  const message = messageOf(failure);
  return new Error(message ?? "OpenCode did not answer.");
};
var createOpencodeConnections = (options = {}) => {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const entries = new Map;
  const pending = new Map;
  const epochs = new Map;
  const invalidate = (sandboxId) => {
    entries.delete(sandboxId);
    epochs.set(sandboxId, (epochs.get(sandboxId) ?? 0) + 1);
  };
  const get = async (sandboxId, readOptions = {}) => {
    const cached = entries.get(sandboxId);
    if (!readOptions.force && cached && Date.now() - cached.at < ttlMs)
      return cached.connection;
    const running = pending.get(sandboxId);
    if (running)
      return running;
    const epoch = epochs.get(sandboxId) ?? 0;
    const promise = build(sandboxId).then((connection) => {
      if ((epochs.get(sandboxId) ?? 0) === epoch)
        entries.set(sandboxId, { at: Date.now(), connection });
      return connection;
    }).finally(() => {
      if (pending.get(sandboxId) === promise)
        pending.delete(sandboxId);
    });
    pending.set(sandboxId, promise);
    return promise;
  };
  return {
    get,
    peek: (sandboxId) => {
      const cached = entries.get(sandboxId);
      return cached && Date.now() - cached.at < ttlMs ? cached.connection : null;
    },
    invalidate,
    forget: invalidate,
    run: async (sandboxId, operation) => {
      let connection = await get(sandboxId);
      try {
        return await operation(connection);
      } catch (failure) {
        if (!isReconnectableFailure(failure))
          throw describeOpencodeError(failure);
        invalidate(sandboxId);
        connection = await get(sandboxId, { force: true });
        try {
          return await operation(connection);
        } catch (second) {
          throw describeOpencodeError(second);
        }
      }
    }
  };
};

// shared/opencode.ts
var OPENCODE_EVENTS_TOPIC = "boat:opencode";
var OPENCODE_STREAM_TOPIC = "boat:opencode-stream";

// service/opencode/normalize.ts
var TOOL_OUTPUT_MAX = 20000;
var INBOX_TEXT_MAX = 400;
var readTimestamp = (value) => {
  if (typeof value === "number" && Number.isFinite(value))
    return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric))
      return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed))
      return parsed;
  }
  return 0;
};
var stringArray = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
var recordOf = (value) => isRecord(value) ? value : null;
var readOutcome = (value) => value === "succeeded" || value === "failed" || value === "interrupted" ? value : null;
var readError = (value) => {
  if (typeof value === "string")
    return readString(value);
  if (!isRecord(value))
    return null;
  return readString(value.message) ?? readString(value.type) ?? null;
};
var readModelRef = (value) => {
  if (!isRecord(value))
    return null;
  const id = readString(value.id);
  const providerID = readString(value.providerID);
  if (!id || !providerID)
    return null;
  return { id, providerID, variant: readString(value.variant) };
};
var toModelRefInput = (model) => ({
  id: model.id,
  providerID: model.providerID,
  ...model.variant ? { variant: model.variant } : {}
});
var readTokens = (value) => {
  if (!isRecord(value))
    return null;
  const cache = isRecord(value.cache) ? value.cache : null;
  return {
    input: readNumber(value.input) ?? 0,
    output: readNumber(value.output) ?? 0,
    reasoning: readNumber(value.reasoning) ?? 0,
    cacheRead: readNumber(cache?.read) ?? 0,
    cacheWrite: readNumber(cache?.write) ?? 0
  };
};
var readAttachment = (value) => {
  if (!isRecord(value))
    return null;
  const source = isRecord(value.source) ? value.source : null;
  const uri = source?.type === "uri" ? readString(source.uri) : null;
  return {
    name: readString(value.name),
    mime: readString(value.mime) ?? "application/octet-stream",
    uri
  };
};
var readToolContent = (value) => {
  if (!Array.isArray(value))
    return { text: null, files: [] };
  const texts = [];
  const files = [];
  for (const entry of value) {
    if (!isRecord(entry))
      continue;
    if (entry.type === "text") {
      const text = typeof entry.text === "string" ? entry.text : "";
      if (text)
        texts.push(text);
    } else if (entry.type === "file") {
      const uri = readString(entry.uri);
      if (!uri)
        continue;
      files.push({
        name: readString(entry.name),
        mime: readString(entry.mime) ?? "application/octet-stream",
        uri
      });
    }
  }
  return { text: texts.length > 0 ? texts.join(`
`) : null, files };
};
var readTodos = (value) => {
  if (!Array.isArray(value))
    return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry))
      return [];
    const content = readString(entry.content);
    if (!content)
      return [];
    const status = readString(entry.status);
    const normalised = status === "in_progress" || status === "completed" || status === "cancelled" ? status : "pending";
    return [{ content, status: normalised, priority: readString(entry.priority) }];
  });
};
var todosOfTools = (tools) => {
  for (let index = tools.length - 1;index >= 0; index -= 1) {
    const tool = tools[index];
    if (!tool?.input)
      continue;
    const todos = readTodos(tool.input.todos);
    if (todos.length > 0)
      return todos;
  }
  return [];
};
var normalizeTool = (raw) => {
  if (!isRecord(raw))
    return null;
  const id = readString(raw.id);
  const name = readString(raw.name);
  if (!id || !name)
    return null;
  const state = isRecord(raw.state) ? raw.state : {};
  const status = readString(state.status);
  const inputValue = state.input;
  const input = isRecord(inputValue) ? inputValue : null;
  const inputText = typeof inputValue === "string" ? inputValue : null;
  const content = readToolContent(state.content);
  const output = content.text === null ? null : clip(content.text, TOOL_OUTPUT_MAX);
  const time = isRecord(raw.time) ? raw.time : {};
  return {
    id,
    name,
    status: status === "streaming" || status === "running" || status === "completed" || status === "error" ? status : "running",
    input,
    inputText,
    output,
    error: readError(state.error),
    files: content.files,
    metadata: recordOf(state.metadata),
    executed: typeof raw.executed === "boolean" ? raw.executed : null,
    startedAt: readTimestamp(time.created) || null,
    completedAt: readTimestamp(time.completed) || null,
    truncated: content.text !== null && content.text.length > TOOL_OUTPUT_MAX
  };
};
var normalizeAssistantContent = (value) => {
  const parts = [];
  const tools = [];
  if (!Array.isArray(value))
    return { parts, todos: [] };
  value.forEach((entry, ordinal) => {
    if (!isRecord(entry))
      return;
    if (entry.type === "text") {
      const text = typeof entry.text === "string" ? entry.text : "";
      if (text)
        parts.push({ kind: "text", ordinal, text });
      return;
    }
    if (entry.type === "reasoning") {
      const text = typeof entry.text === "string" ? entry.text : "";
      if (!text)
        return;
      const time = isRecord(entry.time) ? entry.time : {};
      parts.push({
        kind: "reasoning",
        ordinal,
        text,
        startedAt: readTimestamp(time.created) || null,
        completedAt: readTimestamp(time.completed) || null
      });
      return;
    }
    if (entry.type === "tool") {
      const tool = normalizeTool(entry);
      if (!tool)
        return;
      tools.push(tool);
      parts.push({ kind: "tool", tool });
    }
  });
  const todos = todosOfTools(tools);
  if (todos.length > 0)
    parts.push({ kind: "todo", todos });
  return { parts, todos };
};
var roleOf = (type) => {
  if (type === "user")
    return "user";
  if (type === "assistant")
    return "assistant";
  return "system";
};
var textPart = (text) => text ? [{ kind: "text", ordinal: -1, text }] : [];
var normalizeMessage = (raw, sessionID) => {
  if (!isRecord(raw))
    return null;
  const id = readString(raw.id);
  if (!id)
    return null;
  const type = readString(raw.type) ?? "unknown";
  const time = isRecord(raw.time) ? raw.time : {};
  const createdAt = readTimestamp(time.created);
  const completedAt = readTimestamp(time.completed) || null;
  const role = roleOf(type);
  const model = role === "assistant" ? readModelRef(raw.model) : null;
  const agent = readString(raw.agent);
  const outcome = readOutcome(raw.outcome);
  const error = readError(raw.error);
  const base = {
    id,
    sessionID,
    type,
    role,
    createdAt,
    completedAt,
    agent,
    model,
    parts: [],
    step: null,
    patch: null,
    files: [],
    error,
    outcome,
    streaming: type === "assistant" && completedAt === null,
    notice: null,
    todos: []
  };
  if (type === "assistant") {
    const { parts, todos } = normalizeAssistantContent(raw.content);
    const snapshot = isRecord(raw.snapshot) ? raw.snapshot : null;
    const files = snapshot ? stringArray(snapshot.files) : [];
    const patch = snapshot ? { start: readString(snapshot.start), end: readString(snapshot.end), files } : null;
    if (patch && files.length > 0)
      parts.push({ kind: "patch", patch });
    return {
      ...base,
      parts,
      patch,
      todos,
      step: {
        agent,
        model,
        startedAt: createdAt || null,
        completedAt,
        finish: readString(raw.finish),
        cost: readNumber(raw.cost) ?? 0,
        tokens: readTokens(raw.tokens)
      }
    };
  }
  if (type === "user") {
    const files = Array.isArray(raw.files) ? raw.files.flatMap((entry) => {
      const file = readAttachment(entry);
      return file ? [file] : [];
    }) : [];
    const text = typeof raw.text === "string" ? raw.text : "";
    return {
      ...base,
      parts: [...textPart(text), ...files.map((file) => ({ kind: "file", file }))],
      files
    };
  }
  if (type === "idle") {
    return {
      ...base,
      error: error ?? (outcome === "failed" ? "The turn failed." : null),
      notice: outcome === "interrupted" ? "Interrupted." : null
    };
  }
  if (type === "shell") {
    const output = isRecord(raw.output) ? readString(raw.output.output) : null;
    const command = readString(raw.command);
    const text = output ?? command ?? "";
    return {
      ...base,
      parts: textPart(text),
      notice: command ? `$ ${command}` : null,
      streaming: raw.status === "running"
    };
  }
  if (type === "compaction") {
    const text = readString(raw.summary) ?? readString(raw.text) ?? "";
    const status = readString(raw.status);
    return {
      ...base,
      parts: textPart(text),
      notice: status === "failed" ? "Compaction failed." : "Compacted the conversation.",
      streaming: status === "running"
    };
  }
  if (type === "system" || type === "synthetic" || type === "skill") {
    const text = readString(raw.text) ?? "";
    return {
      ...base,
      parts: textPart(text),
      notice: readString(raw.description) ?? (type === "skill" ? readString(raw.name) : null)
    };
  }
  if (type === "agent-switched") {
    return { ...base, notice: `Agent switched to ${readString(raw.agent) ?? "another agent"}.` };
  }
  if (type === "model-switched") {
    const switched = readModelRef(raw.model);
    return {
      ...base,
      notice: switched ? `Model switched to ${switched.providerID}/${switched.id}.` : "Model switched."
    };
  }
  if (type === "location-switched") {
    const location = isRecord(raw.location) ? readString(raw.location.directory) : null;
    return { ...base, notice: location ? `Moved to ${location}.` : "Moved to another directory." };
  }
  const text = readString(raw.text) ?? "";
  return { ...base, parts: textPart(text) };
};
var INBOX_TYPES = ["user", "synthetic", "compaction", "move"];
var normalizeInboxEntry = (raw) => {
  if (!isRecord(raw))
    return null;
  const id = readString(raw.id);
  const sessionID = readString(raw.sessionID);
  if (!id || !sessionID)
    return null;
  const payload = isRecord(raw.payload) ? raw.payload : {};
  const type = readString(raw.type);
  const delivery = raw.delivery === "steer" ? "steer" : "queue";
  const files = Array.isArray(payload.files) ? payload.files.flatMap((entry) => {
    const file = readAttachment(entry);
    return file ? [file] : [];
  }) : [];
  return {
    id,
    sessionID,
    text: clip(readString(payload.text) ?? "", INBOX_TEXT_MAX),
    delivery,
    createdAt: readTimestamp(isRecord(raw.time) ? raw.time.created : null),
    files,
    type: type !== null && INBOX_TYPES.includes(type) ? type : "user"
  };
};
var normalizeSession = (raw) => {
  if (!isRecord(raw))
    return null;
  const id = readString(raw.id) ?? readString(raw.sessionID);
  if (!id)
    return null;
  const time = isRecord(raw.time) ? raw.time : {};
  const location = isRecord(raw.location) ? raw.location : null;
  const outcome = readOutcome(raw.outcome);
  const busyAt = readTimestamp(time.busy) || null;
  const idleAt = readTimestamp(time.idle) || null;
  const busy = busyAt !== null && busyAt > (idleAt ?? 0);
  return {
    id,
    title: readString(raw.title),
    directory: readString(location?.directory),
    projectID: readString(raw.projectID),
    agent: readString(raw.agent),
    model: readModelRef(raw.model),
    createdAt: readTimestamp(time.created),
    updatedAt: readTimestamp(time.updated) || readTimestamp(time.created),
    busyAt,
    idleAt,
    archived: readTimestamp(time.archived) > 0,
    outcome,
    status: busy ? "busy" : outcome === "failed" ? "error" : "idle",
    cost: readNumber(raw.cost) ?? 0
  };
};
var normalizePermissionRequest = (raw) => {
  if (!isRecord(raw))
    return null;
  const id = readString(raw.id);
  const sessionID = readString(raw.sessionID);
  if (!id || !sessionID)
    return null;
  const source = isRecord(raw.source) ? readString(raw.source.type) : null;
  return {
    id,
    sessionID,
    action: readString(raw.action) ?? "unknown",
    resources: stringArray(raw.resources),
    save: stringArray(raw.save),
    message: readString(raw.message),
    source,
    agent: readString(raw.agent)
  };
};
var QUESTION_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "multiselect",
  "external"
];
var readQuestionOptions = (value) => Array.isArray(value) ? value.flatMap((entry) => {
  if (!isRecord(entry))
    return [];
  const optionValue = readString(entry.value);
  if (!optionValue)
    return [];
  return [{
    value: optionValue,
    label: readString(entry.label) ?? optionValue,
    description: readString(entry.description)
  }];
}) : [];
var readDefault = (value) => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value))
    return stringArray(value);
  return null;
};
var readQuestionField = (raw) => {
  if (!isRecord(raw))
    return null;
  const key = readString(raw.key);
  const rawType = readString(raw.type);
  if (!key || !rawType || !QUESTION_TYPES.includes(rawType))
    return null;
  return {
    key,
    type: rawType,
    title: readString(raw.title) ?? key,
    description: readString(raw.description),
    required: raw.required === true,
    hidden: raw.hidden === true,
    options: readQuestionOptions(raw.options),
    minLength: readNumber(raw.minLength),
    maxLength: readNumber(raw.maxLength),
    min: readNumber(raw.minimum),
    max: readNumber(raw.maximum),
    minItems: readNumber(raw.minItems),
    maxItems: readNumber(raw.maxItems),
    default: readDefault(raw.default),
    url: readString(raw.url)
  };
};
var normalizeQuestionRequest = (raw) => {
  if (!isRecord(raw))
    return null;
  const id = readString(raw.id);
  const sessionID = readString(raw.sessionID);
  if (!id || !sessionID)
    return null;
  const fields = Array.isArray(raw.fields) ? raw.fields.flatMap((entry) => {
    const field = readQuestionField(entry);
    return field ? [field] : [];
  }) : [];
  return {
    id,
    sessionID,
    title: readString(raw.title) ?? "OpenCode needs an answer",
    fields,
    metadata: recordOf(raw.metadata)
  };
};
var normalizeAgent = (raw) => {
  if (!isRecord(raw))
    return null;
  const id = readString(raw.id);
  if (!id)
    return null;
  return {
    id,
    name: readString(raw.name) ?? id,
    description: readString(raw.description),
    mode: readString(raw.mode) ?? "primary",
    hidden: raw.hidden === true,
    model: readModelRef(raw.model)
  };
};
var normalizeProvider = (raw) => {
  if (!isRecord(raw))
    return null;
  const id = readString(raw.id);
  if (!id)
    return null;
  return { id, name: readString(raw.name) ?? id };
};
var normalizeModel = (raw, providerName) => {
  if (!isRecord(raw))
    return null;
  const id = readString(raw.id) ?? readString(raw.modelID);
  const providerID = readString(raw.providerID);
  if (!id || !providerID)
    return null;
  const variants = Array.isArray(raw.variants) ? raw.variants.flatMap((entry) => {
    const variant = isRecord(entry) ? readString(entry.id) : null;
    return variant ? [variant] : [];
  }) : [];
  const capabilities = isRecord(raw.capabilities) ? raw.capabilities : null;
  const inputs = Array.isArray(capabilities?.input) ? capabilities.input.filter((entry) => typeof entry === "string") : null;
  const limit = isRecord(raw.limit) ? raw.limit : null;
  return {
    id,
    providerID,
    providerName,
    name: readString(raw.name) ?? id,
    type: readString(raw.type),
    variants,
    reasoning: variants.length > 0,
    tools: capabilities?.tools === true,
    imageInput: inputs === null ? null : inputs.includes("image"),
    contextLimit: readNumber(limit?.context),
    outputLimit: readNumber(limit?.output),
    enabled: raw.enabled !== false
  };
};
var normalizeModels = (value, providerNames) => Array.isArray(value) ? value.flatMap((entry) => {
  if (!isRecord(entry))
    return [];
  const providerID = readString(entry.providerID);
  const model = normalizeModel(entry, providerID ? providerNames.get(providerID) ?? providerID : "");
  return model ? [model] : [];
}) : [];
var eventData = (raw) => isRecord(raw.data) ? raw.data : {};
var sessionIDOf = (data) => readString(data.sessionID);
var messageIDOf = (data) => readString(data.assistantMessageID) ?? readString(data.messageID);
var toolResultOf = (data, status) => {
  const sessionID = sessionIDOf(data);
  const messageID = messageIDOf(data);
  const toolID = readString(data.id);
  if (!sessionID || !messageID || !toolID)
    return null;
  const content = readToolContent(data.content);
  const output = content.text === null ? null : clip(content.text, TOOL_OUTPUT_MAX);
  return {
    type: "tool-result",
    sessionID,
    messageID,
    toolID,
    status,
    output,
    files: content.files,
    error: readError(data.error),
    metadata: recordOf(data.metadata),
    executed: typeof data.executed === "boolean" ? data.executed : null,
    truncated: content.text !== null && content.text.length > TOOL_OUTPUT_MAX
  };
};
var normalizeStreamEvent = (raw) => {
  if (!isRecord(raw))
    return null;
  const type = readString(raw.type);
  if (!type)
    return null;
  const data = eventData(raw);
  const sessionID = sessionIDOf(data);
  const messageID = messageIDOf(data);
  switch (type) {
    case "session.created": {
      const session = normalizeSession({
        ...data,
        id: data.sessionID,
        time: { created: readTimestamp(raw.created), updated: readTimestamp(raw.created) }
      });
      return session ? { type: "session-created", session } : null;
    }
    case "session.renamed":
      if (!sessionID)
        return null;
      return { type: "session-updated", sessionID, title: readString(data.title), directory: null };
    case "session.moved": {
      if (!sessionID)
        return null;
      const location = isRecord(data.location) ? readString(data.location.directory) : null;
      return { type: "session-updated", sessionID, title: null, directory: location };
    }
    case "session.deleted":
      return sessionID ? { type: "session-deleted", sessionID } : null;
    case "session.archived":
    case "session.unarchived":
    case "session.model.selected":
    case "session.agent.selected":
    case "session.permissions":
    case "session.metadata.updated":
      return sessionID ? { type: "session-updated", sessionID, title: null, directory: null } : null;
    case "session.status": {
      if (!sessionID)
        return null;
      const status = isRecord(data.status) ? data.status : null;
      const kind = readString(status?.type);
      if (kind === "busy")
        return { type: "status", sessionID, status: "busy", error: null };
      if (kind === "idle")
        return { type: "status", sessionID, status: "idle", error: null };
      if (kind === "retry") {
        return { type: "status", sessionID, status: "busy", error: readString(status?.message) };
      }
      return null;
    }
    case "session.execution.started":
      return sessionID ? { type: "status", sessionID, status: "busy", error: null } : null;
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return sessionID ? { type: "status", sessionID, status: "idle", error: null } : null;
    case "session.execution.failed":
      return sessionID ? { type: "status", sessionID, status: "error", error: readError(data.error) } : null;
    case "session.idle":
      return sessionID ? { type: "status", sessionID, status: "idle", error: null } : null;
    case "session.retry.scheduled":
      return sessionID ? { type: "status", sessionID, status: "busy", error: readString(data.message) } : null;
    case "session.step.started":
      if (!sessionID || !messageID)
        return null;
      return {
        type: "step",
        sessionID,
        messageID,
        phase: "started",
        agent: readString(data.agent),
        model: readModelRef(data.model),
        finish: null,
        cost: null,
        tokens: null,
        error: null
      };
    case "session.step.ended":
    case "session.step.failed":
      if (!sessionID || !messageID)
        return null;
      return {
        type: "step",
        sessionID,
        messageID,
        phase: "ended",
        agent: null,
        model: null,
        finish: readString(data.finish),
        cost: readNumber(data.cost),
        tokens: readTokens(data.tokens),
        error: readError(data.error)
      };
    case "session.text.started":
    case "session.reasoning.started": {
      if (!sessionID || !messageID)
        return null;
      const ordinal = readNumber(data.ordinal) ?? 0;
      return {
        type: "part-start",
        sessionID,
        messageID,
        part: type === "session.text.started" ? "text" : "reasoning",
        ordinal
      };
    }
    case "session.text.delta":
    case "session.reasoning.delta": {
      if (!sessionID || !messageID)
        return null;
      const delta = typeof data.delta === "string" ? data.delta : "";
      if (!delta)
        return null;
      return {
        type: "delta",
        sessionID,
        messageID,
        part: type === "session.text.delta" ? "text" : "reasoning",
        ordinal: readNumber(data.ordinal) ?? 0,
        delta
      };
    }
    case "session.text.ended":
    case "session.reasoning.ended": {
      if (!sessionID || !messageID)
        return null;
      const ordinal = readNumber(data.ordinal) ?? 0;
      if (type === "session.text.ended") {
        return {
          type: "part",
          sessionID,
          messageID,
          part: { kind: "text", ordinal, text: typeof data.text === "string" ? data.text : "" }
        };
      }
      return {
        type: "part",
        sessionID,
        messageID,
        part: { kind: "reasoning", ordinal, text: typeof data.text === "string" ? data.text : "", startedAt: null, completedAt: null }
      };
    }
    case "session.tool.input.started": {
      if (!sessionID || !messageID)
        return null;
      const toolID = readString(data.id);
      const name = readString(data.name);
      if (!toolID || !name)
        return null;
      return { type: "tool-start", sessionID, messageID, toolID, name };
    }
    case "session.tool.input.delta": {
      if (!sessionID || !messageID)
        return null;
      const toolID = readString(data.id);
      const delta = typeof data.delta === "string" ? data.delta : "";
      if (!toolID || !delta)
        return null;
      return { type: "tool-input-delta", sessionID, messageID, toolID, delta };
    }
    case "session.tool.input.ended": {
      if (!sessionID || !messageID)
        return null;
      const toolID = readString(data.id);
      if (!toolID)
        return null;
      return {
        type: "tool-input",
        sessionID,
        messageID,
        toolID,
        text: typeof data.text === "string" ? data.text : ""
      };
    }
    case "session.tool.called": {
      if (!sessionID || !messageID)
        return null;
      const toolID = readString(data.id);
      if (!toolID)
        return null;
      return {
        type: "tool-called",
        sessionID,
        messageID,
        toolID,
        input: recordOf(data.input),
        executed: typeof data.executed === "boolean" ? data.executed : null
      };
    }
    case "session.tool.progress": {
      if (!sessionID || !messageID)
        return null;
      const toolID = readString(data.id);
      const metadata = recordOf(data.metadata);
      if (!toolID || !metadata)
        return null;
      return { type: "tool-progress", sessionID, messageID, toolID, metadata };
    }
    case "session.tool.success":
    case "session.tool.failed":
      return toolResultOf(data, type === "session.tool.success" ? "completed" : "error");
    case "session.message.content.updated": {
      if (!sessionID || !messageID)
        return null;
      const { parts } = normalizeAssistantContent(data.content);
      return { type: "message-content", sessionID, messageID, parts };
    }
    case "session.inbox.enqueued":
    case "session.inbox.cancelled":
    case "session.inbox.delivery.changed": {
      if (!sessionID)
        return null;
      return { type: "inbox-changed", sessionID };
    }
    case "session.inbox.delivered": {
      if (!sessionID)
        return null;
      return { type: "message-changed", sessionID, messageID: readString(data.inboxID) };
    }
    case "session.synthetic":
    case "session.skill.activated":
    case "session.shell.started":
    case "session.shell.ended":
    case "session.compaction.started":
    case "session.compaction.delta":
    case "session.compaction.ended":
    case "session.compaction.failed":
    case "session.instructions.updated":
      return sessionID ? { type: "message-changed", sessionID, messageID: null } : null;
    case "permission.asked": {
      const request = normalizePermissionRequest(data);
      return request ? { type: "permission", request } : null;
    }
    case "permission.replied": {
      if (!sessionID)
        return null;
      const requestID = readString(data.requestID);
      const reply = readString(data.reply);
      if (!requestID || reply !== "once" && reply !== "always" && reply !== "reject")
        return null;
      return {
        type: "permission-replied",
        sessionID,
        requestID,
        reply
      };
    }
    case "form.created": {
      const form = isRecord(data.form) ? normalizeQuestionRequest(data.form) : null;
      return form ? { type: "question", request: form } : null;
    }
    case "form.replied":
    case "form.cancelled": {
      if (!sessionID)
        return null;
      const questionID = readString(data.id);
      return questionID ? { type: "question-replied", sessionID, questionID } : null;
    }
    default:
      return null;
  }
};

// service/opencode/followers.ts
var MAX_BATCH_EVENTS = 40;
var MAX_BATCH_CHARS = 36000;
var eventSize = (event) => {
  try {
    return JSON.stringify(event).length;
  } catch {
    return 1000;
  }
};
var createOpencodeFollowers = (options) => {
  const followers = new Map;
  let sweeper = null;
  const send = (topic, data) => {
    try {
      Promise.resolve(options.sink(topic, data)).catch(() => {});
    } catch {}
  };
  const sendState = (follower, state, message) => {
    const payload = { sandbox: follower.sandboxId, state, message };
    send(OPENCODE_STREAM_TOPIC, payload);
  };
  const flush = (follower) => {
    if (follower.flushTimer) {
      clearTimeout(follower.flushTimer);
      follower.flushTimer = null;
    }
    if (follower.buffer.length === 0)
      return;
    const batch = [];
    let chars = 0;
    while (follower.buffer.length > 0 && batch.length < MAX_BATCH_EVENTS) {
      const next = follower.buffer[0];
      if (!next)
        break;
      const size = eventSize(next);
      if (batch.length > 0 && chars + size > MAX_BATCH_CHARS)
        break;
      follower.buffer.shift();
      batch.push(next);
      chars += size;
    }
    if (batch.length > 0) {
      const payload = { sandbox: follower.sandboxId, events: batch };
      send(OPENCODE_EVENTS_TOPIC, payload);
    }
    if (follower.buffer.length > 0 && !follower.stopped) {
      follower.flushTimer = setTimeout(() => flush(follower), options.flushMs);
    }
  };
  const queue = (follower, event) => {
    follower.buffer.push(event);
    if (follower.buffer.length >= MAX_BATCH_EVENTS) {
      flush(follower);
      return;
    }
    if (!follower.flushTimer)
      follower.flushTimer = setTimeout(() => flush(follower), options.flushMs);
  };
  const dispose = (follower) => {
    follower.stopped = true;
    follower.controller?.abort();
    follower.controller = null;
    if (follower.flushTimer) {
      clearTimeout(follower.flushTimer);
      follower.flushTimer = null;
    }
    followers.delete(follower.sandboxId);
  };
  const ensureSweeper = () => {
    if (sweeper)
      return;
    sweeper = setInterval(() => {
      const now = Date.now();
      for (const follower of [...followers.values()]) {
        if (now - follower.lastPing > options.ttlMs)
          dispose(follower);
      }
      if (followers.size === 0 && sweeper) {
        clearInterval(sweeper);
        sweeper = null;
      }
    }, options.sweepMs);
    sweeper.unref();
  };
  const open = async (follower) => {
    let retried = false;
    while (!follower.stopped) {
      let connection;
      try {
        connection = await options.connections.get(follower.sandboxId);
      } catch (failure) {
        sendState(follower, "error", describeOpencodeError(failure).message);
        dispose(follower);
        return;
      }
      const controller = new AbortController;
      follower.controller = controller;
      let seen = false;
      try {
        for await (const raw of connection.client.event.subscribe({ signal: controller.signal })) {
          if (follower.stopped)
            return;
          seen = true;
          if (!follower.live) {
            follower.live = true;
            sendState(follower, "live", null);
          }
          const event = normalizeStreamEvent(raw);
          if (event)
            queue(follower, event);
        }
        if (follower.stopped)
          return;
        flush(follower);
        sendState(follower, "ended", null);
        dispose(follower);
        return;
      } catch (failure) {
        if (follower.stopped)
          return;
        if (!seen && !retried && isReconnectableFailure(failure)) {
          retried = true;
          options.connections.invalidate(follower.sandboxId);
          continue;
        }
        flush(follower);
        sendState(follower, "error", describeOpencodeError(failure).message);
        dispose(follower);
        return;
      }
    }
  };
  return {
    watch: (sandboxId) => {
      const existing = followers.get(sandboxId);
      if (existing) {
        existing.lastPing = Date.now();
        return;
      }
      const follower = {
        sandboxId,
        lastPing: Date.now(),
        controller: null,
        buffer: [],
        flushTimer: null,
        stopped: false,
        live: false
      };
      followers.set(sandboxId, follower);
      ensureSweeper();
      open(follower).catch((failure) => {
        sendState(follower, "error", describeOpencodeError(failure).message);
        dispose(follower);
      });
    },
    unwatch: (sandboxId) => {
      const follower = followers.get(sandboxId);
      if (follower)
        dispose(follower);
    },
    stopAll: () => {
      for (const follower of [...followers.values()])
        dispose(follower);
    }
  };
};
var installFollowerCleanup = (followers, others = []) => {
  const stopAll = () => {
    followers.stopAll();
    for (const other of others)
      other.stopAll();
  };
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      stopAll();
      process.exit(0);
    });
  }
  process.on("exit", stopAll);
};

// service/opencode/reads.ts
var SESSION_PAGE = 100;
var SESSION_PAGES_MAX = 4;
var MESSAGE_PAGE = 200;
var MAX_MESSAGE_PAGES = 10;
var rowsOf = (value) => {
  if (Array.isArray(value))
    return value;
  return isRecord(value) && Array.isArray(value.data) ? value.data : [];
};
var sessionsOf = (rows) => rows.flatMap((entry) => {
  const session = normalizeSession(entry);
  return session ? [session] : [];
});
var cursorOf = (raw) => readString(isRecord(raw) && isRecord(raw.cursor) ? raw.cursor.next : null);
var readSessions = async (connection, directory = null) => {
  const rows = [];
  let cursor = null;
  for (let page = 0;page < (directory ? SESSION_PAGES_MAX : 1); page += 1) {
    const raw = await connection.client.session.list({
      limit: SESSION_PAGE,
      ...cursor ? { cursor } : { order: "desc" }
    });
    const batch = rowsOf(raw);
    rows.push(...batch);
    if (!directory)
      break;
    if (sessionsOf(rows).filter((session) => session.directory === directory).length >= SESSION_PAGE)
      break;
    cursor = cursorOf(raw);
    if (!cursor || batch.length === 0)
      break;
  }
  const sessions = sessionsOf(rows);
  if (!directory)
    return sessions;
  return sessions.filter((session) => session.directory === directory).slice(0, SESSION_PAGE);
};
var readSession = async (connection, sessionID) => {
  const raw = await connection.client.session.get({ sessionID });
  return normalizeSession(raw);
};
var readSessionMessages = async (connection, sessionID) => {
  const rows = [];
  const seen = new Set;
  let cursor = null;
  for (let page = 0;page < MAX_MESSAGE_PAGES; page += 1) {
    const raw = await connection.client.message.list({
      sessionID,
      limit: MESSAGE_PAGE,
      ...cursor ? { cursor } : { order: "asc" }
    });
    for (const row of rowsOf(raw)) {
      const id = isRecord(row) ? readString(row.id) : null;
      if (id && seen.has(id))
        continue;
      if (id)
        seen.add(id);
      rows.push(row);
    }
    const cursors = isRecord(raw) && isRecord(raw.cursor) ? raw.cursor : null;
    cursor = readString(cursors?.next);
    if (!cursor) {
      return {
        messages: rows.flatMap((row) => {
          const message = normalizeMessage(row, sessionID);
          return message ? [message] : [];
        }),
        truncated: false
      };
    }
  }
  return {
    messages: rows.flatMap((row) => {
      const message = normalizeMessage(row, sessionID);
      return message ? [message] : [];
    }),
    truncated: true
  };
};
var readPermissions = async (connection, sessionID) => {
  const raw = await connection.client.permission.list({ sessionID });
  return rowsOf(raw).flatMap((entry) => {
    const request = normalizePermissionRequest(entry);
    return request ? [request] : [];
  });
};
var readQuestions = async (connection, sessionID) => {
  const raw = await connection.client.session.form.list({ sessionID });
  return rowsOf(raw).flatMap((entry) => {
    const request = normalizeQuestionRequest(entry);
    return request ? [request] : [];
  });
};
var readInbox = async (connection, sessionID) => {
  const raw = await connection.client.session.inbox.list({ sessionID });
  return rowsOf(raw).flatMap((entry) => {
    const item = normalizeInboxEntry(entry);
    return item ? [item] : [];
  });
};
var readCatalog = async (connection) => {
  const [agentsRaw, providersRaw, modelsRaw, defaultRaw] = await Promise.all([
    connection.client.agent.list(),
    connection.client.provider.list(),
    connection.client.model.list(),
    connection.client.model.default()
  ]);
  const agents = rowsOf(agentsRaw).flatMap((entry) => {
    const agent = normalizeAgent(entry);
    return agent ? [agent] : [];
  });
  const providers = rowsOf(providersRaw).flatMap((entry) => {
    const provider = normalizeProvider(entry);
    return provider ? [provider] : [];
  });
  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name]));
  const models = normalizeModels(rowsOf(modelsRaw), providerNames);
  const defaultData = isRecord(defaultRaw) && isRecord(defaultRaw.data) ? defaultRaw.data : defaultRaw;
  return {
    agents,
    providers,
    models,
    defaultAgent: agents.find((agent) => agent.mode === "primary" && !agent.hidden)?.id ?? null,
    defaultModel: readModelRef(defaultData)
  };
};

// service/opencode/sessions.ts
var createOpencodeSessions = (options) => {
  const entries = new Map;
  const busy = new Set;
  const checkedAt = new Map;
  const pending = new Map;
  const remember = (sandboxId, sessions) => {
    entries.set(sandboxId, { at: Date.now(), sessions });
    if (sessions.some((session) => session.status === "busy"))
      busy.add(sandboxId);
    else
      busy.delete(sandboxId);
    return sessions;
  };
  const load = (sandboxId) => {
    const running = pending.get(sandboxId);
    if (running)
      return running;
    const promise = options.connections.run(sandboxId, (connection) => readSessions(connection)).then((sessions) => remember(sandboxId, sessions)).finally(() => {
      if (pending.get(sandboxId) === promise)
        pending.delete(sandboxId);
    });
    pending.set(sandboxId, promise);
    return promise;
  };
  return {
    get: async (sandboxId, readOptions = {}) => {
      const cached = entries.get(sandboxId);
      if (!readOptions.force && cached && Date.now() - cached.at < options.ttlMs)
        return cached.sessions;
      return load(sandboxId);
    },
    peek: (sandboxId) => entries.get(sandboxId)?.sessions ?? null,
    busy: (sandboxId) => busy.has(sandboxId),
    busyAll: () => busy,
    check: (sandboxId) => {
      const now = Date.now();
      if (now - (checkedAt.get(sandboxId) ?? 0) < options.checkMs)
        return;
      if (!options.connections.peek(sandboxId))
        return;
      checkedAt.set(sandboxId, now);
      load(sandboxId).catch(() => {});
    },
    forget: (sandboxId) => {
      entries.delete(sandboxId);
      busy.delete(sandboxId);
      checkedAt.delete(sandboxId);
    },
    sweep: (valid) => {
      for (const id of [...entries.keys()])
        if (!valid.has(id))
          entries.delete(id);
      for (const id of [...busy])
        if (!valid.has(id))
          busy.delete(id);
      for (const id of [...checkedAt.keys()])
        if (!valid.has(id))
          checkedAt.delete(id);
    }
  };
};

// service/project/ranking.ts
var MAX_DIRECTORIES = 8;
var createProjectRanking = () => {
  const byDirectory = new Map;
  return {
    remember: (directory, inProject) => {
      byDirectory.delete(directory);
      byDirectory.set(directory, inProject);
      if (byDirectory.size <= MAX_DIRECTORIES)
        return;
      const oldest = byDirectory.keys().next().value;
      if (oldest)
        byDirectory.delete(oldest);
    },
    projectIds: (directory) => byDirectory.get(directory) ?? null
  };
};

// service/project/remotes.ts
import { execFile as execFile2 } from "node:child_process";
var GIT_TIMEOUT_MS = 2000;
var MAX_REMOTES = 8;
var git = (args) => new Promise((resolve, reject) => {
  execFile2("git", args, { timeout: GIT_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
    if (error)
      reject(error);
    else
      resolve(stdout);
  });
});
var readProjectRemotes = async (directory) => {
  let names;
  try {
    names = (await git(["-C", directory, "remote"])).split(/\r?\n/).map((name) => name.trim()).filter(Boolean).slice(0, MAX_REMOTES);
  } catch {
    return [];
  }
  if (names.length === 0)
    return [];
  const ordered = names.includes("origin") ? ["origin", ...names.filter((name) => name !== "origin")] : names;
  const slugs = [];
  for (const name of ordered) {
    try {
      const slug = normalizeRepoSlug((await git(["-C", directory, "remote", "get-url", name])).trim());
      if (slug && !slugs.includes(slug))
        slugs.push(slug);
    } catch {}
  }
  return slugs;
};
var createRemoteCache = (options) => {
  const entries = new Map;
  return {
    get: async (directory) => {
      const cached = entries.get(directory);
      if (cached && Date.now() - cached.at < options.ttlMs)
        return cached.slugs;
      const slugs = await readProjectRemotes(directory);
      entries.set(directory, { at: Date.now(), slugs });
      return slugs;
    }
  };
};

// service/project/scope.ts
import { isAbsolute as isAbsolute2 } from "node:path";

// service/project/matcher.ts
var PROJECT_LABEL_KEY = "openchamber.project";
var folderNameOf = (directory) => {
  if (!directory)
    return null;
  const parts = directory.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1]?.toLowerCase() ?? null;
};
var labelMatches = (sandbox, scope) => {
  const label = sandbox.labels[PROJECT_LABEL_KEY]?.trim();
  if (!label)
    return false;
  const slug = normalizeRepoSlug(label);
  if (slug && scope.repoSlugs.includes(slug))
    return true;
  if (!scope.folderName)
    return false;
  if (slug === scope.folderName)
    return true;
  return label.toLowerCase() === scope.folderName;
};
var matchSandbox = (sandbox, environment, scope) => {
  if (labelMatches(sandbox, scope))
    return "label";
  if (environment && scope.repoSlugs.length > 0) {
    if (environment.repos.some((repo) => scope.repoSlugs.includes(repo)))
      return "repo";
  }
  const env = sandbox.environment?.toLowerCase() ?? null;
  if (scope.folderName && env === scope.folderName)
    return "name";
  return null;
};
var chooseEnvironment = (environments, scope) => {
  const byRepo = environments.find((environment) => environment.repos.some((repo) => scope.repoSlugs.includes(repo)));
  if (byRepo)
    return byRepo.name;
  if (scope.folderName) {
    const byName = environments.find((environment) => environment.name.toLowerCase() === scope.folderName);
    if (byName)
      return byName.name;
  }
  return environments.find((environment) => environment.isDefault)?.name ?? environments[0]?.name ?? null;
};

// service/project/scope.ts
var usableDirectory = (directory) => directory && isAbsolute2(directory) && !directory.includes("\x00") ? directory : null;
var createScoper = (deps) => ({
  apply: async (sandboxes, directory) => {
    const project = usableDirectory(directory);
    if (!project) {
      return {
        entries: sandboxes.map((sandbox) => ({ sandbox, matchedBy: null, inProject: false })),
        scoped: false,
        folderName: null,
        others: 0
      };
    }
    const folderName = folderNameOf(project);
    const [repoSlugs, environments] = await Promise.all([
      deps.remotes.get(project),
      deps.environments.get().catch(() => [])
    ]);
    const byName = new Map(environments.map((environment) => [environment.name.toLowerCase(), environment]));
    const scope = { folderName, repoSlugs };
    const entries = sandboxes.map((sandbox) => {
      const environment = sandbox.environment ? byName.get(sandbox.environment.toLowerCase()) ?? null : null;
      const matchedBy = matchSandbox(sandbox, environment, scope);
      return { sandbox, matchedBy, inProject: matchedBy !== null };
    });
    deps.ranking.remember(project, new Set(entries.filter((entry) => entry.inProject).map((entry) => entry.sandbox.id)));
    return {
      entries,
      scoped: true,
      folderName,
      others: entries.filter((entry) => !entry.inProject).length
    };
  }
});

// shared/routes.ts
var errorBody = (error) => ({ error });
var ROW_ID_MAX = 40;
var rowId = (text) => text.length <= ROW_ID_MAX ? text : `${text.slice(0, ROW_ID_MAX - 1).trimEnd()}…`;
var statusActionId = (verb, sandboxId) => rowId(`${verb}-${sandboxId.replace(/_/g, "-").toLowerCase()}`);
var parseStatusActionId = (id) => {
  const match = /^(stop|extend|resume)-([a-z0-9-]{1,32})$/.exec(id);
  if (!match?.[1] || !match[2])
    return null;
  return { verb: match[1], sandboxId: match[2].replace("-", "_") };
};

// service/status/actions.ts
var readStatusAction = (body, sandboxes) => {
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
  const decoded = parseStatusActionId(id);
  if (!decoded)
    return null;
  const known = sandboxes.find((sandbox) => statusActionId(decoded.verb, sandbox.id) === id);
  return known ? { verb: decoded.verb, sandboxId: known.id } : decoded;
};
var performSandboxAction = async (verb, sandbox) => {
  if (verb === "stop") {
    await stopSandbox(sandbox.id);
    return;
  }
  if (verb === "resume") {
    await resumeSandbox(sandbox.id);
    return;
  }
  await extendSandbox(sandbox.id, extendSeconds(sandbox));
};

// service/status/view.ts
var ROWS_MAX = 16;
var ROW_ID_MAX2 = 40;
var LABEL_MAX = 60;
var VALUE_MAX = 80;
var NOTE_MAX = 300;
var TOOLTIP_MAX = 200;
var clip2 = (text, max) => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
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
var sizeOf2 = (sandbox) => {
  const parts = [sandbox.type, sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`].filter(Boolean);
  return parts.length === 0 ? null : parts.join(" ");
};
var timeLeft = (sandbox, now) => {
  if (!isUpState(sandbox.state))
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
  const parts = [sandbox.state, sizeOf2(sandbox), timeLeft(sandbox, now)].filter(Boolean);
  return clip2(parts.join(" · "), VALUE_MAX);
};
var dotOf = (state) => {
  if (isUpState(state))
    return "success";
  if (isPendingState(state))
    return "warning";
  if (isStoppedState(state))
    return "muted";
  if (state === "error")
    return "error";
  return "muted";
};
var tooltipOf = (sandbox, now) => {
  const deadline = sandbox.archiveAfter ? Date.parse(sandbox.archiveAfter) : Number.NaN;
  const parts = [
    sandbox.id,
    sandbox.environment ? `env ${sandbox.environment}` : null,
    sandbox.vcpu === null ? null : `${sandbox.vcpu} vCPU`,
    sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`,
    sandbox.sshEndpoint ? `ssh ${sandbox.sshEndpoint}` : null,
    Number.isFinite(deadline) ? `auto-stops ${new Date(deadline).toLocaleString()} (in ${formatDuration(deadline - now)})` : null
  ].filter(Boolean);
  return clip2(parts.join(" · "), TOOLTIP_MAX);
};
var actionsOf = (sandbox) => {
  if (!isUpState(sandbox.state)) {
    if (isStoppedState(sandbox.state)) {
      return [{ kind: "button", id: statusActionId("resume", sandbox.id), label: "Resume" }];
    }
    if (isBootingState(sandbox.state)) {
      return [{
        kind: "button",
        id: statusActionId("stop", sandbox.id),
        label: "Cancel",
        variant: "destructive",
        confirm: "Stop this sandbox while it is still starting?"
      }];
    }
    return [];
  }
  const extend = {
    kind: "button",
    id: statusActionId("extend", sandbox.id),
    label: "Extend 1h",
    variant: "outline",
    disabled: !sandbox.archiveAfter && sandbox.ttlSeconds === null
  };
  return [
    {
      kind: "button",
      id: statusActionId("stop", sandbox.id),
      label: "Stop",
      variant: "destructive",
      confirm: "Stop this sandbox?"
    },
    extend
  ];
};
var desktopChip = (sandbox, desktopUrls) => {
  const url = desktopUrls.get(sandbox.id);
  if (!url || !isUpState(sandbox.state))
    return null;
  return {
    id: clip2(`desk-${sandbox.id.replace(/_/g, "-").toLowerCase()}`, ROW_ID_MAX2),
    label: "Desktop",
    url
  };
};
var orderOf = (sandbox) => {
  if (isUpState(sandbox.state))
    return 0;
  if (isPendingState(sandbox.state))
    return 1;
  if (isStoppedState(sandbox.state))
    return 2;
  return 3;
};
var buildStatusView = (input) => {
  const notes = [];
  if (input.failure) {
    notes.push({ kind: "note", id: "note-error", text: clip2(input.failure.text, NOTE_MAX), tone: input.failure.tone });
  }
  if (!input.failure && input.sandboxes.length === 0) {
    notes.push({
      kind: "note",
      id: "note-empty",
      text: input.scoped ? "No sandbox for this project. Pin one with the `openchamber.project` label, or add this repository to its boat environment." : "No sandboxes. Create one with `boat new`, then reopen this section.",
      tone: "info"
    });
  }
  if (input.scoped && input.others > 0) {
    notes.push({
      kind: "note",
      id: "note-others",
      text: `${input.others} other sandbox${input.others === 1 ? "" : "es"} in other projects.`,
      tone: "muted"
    });
  }
  if (input.planNote) {
    notes.push({ kind: "note", id: "note-plan", text: clip2(input.planNote, NOTE_MAX), tone: "warning" });
  }
  const lines = input.sandboxes.slice().sort((left, right) => {
    const byAgent = Number(input.busy.has(right.id)) - Number(input.busy.has(left.id));
    if (byAgent !== 0)
      return byAgent;
    const byState = orderOf(left) - orderOf(right);
    if (byState !== 0)
      return byState;
    return (Date.parse(right.createdAt ?? "") || 0) - (Date.parse(left.createdAt ?? "") || 0);
  }).map((sandbox) => {
    const row = {
      kind: "line",
      id: clip2(`sb-${sandbox.id.replace(/_/g, "-").toLowerCase()}`, ROW_ID_MAX2),
      label: clip2(sandbox.name || sandbox.id, LABEL_MAX),
      dot: dotOf(sandbox.state),
      value: valueOf(sandbox, input.now),
      tooltip: tooltipOf(sandbox, input.now),
      actions: actionsOf(sandbox)
    };
    if (input.busy.has(sandbox.id))
      row.badge = { label: "agent running", tone: "accent" };
    const chip = desktopChip(sandbox, input.desktopUrls);
    if (chip)
      row.content = { kind: "chips", chips: [chip] };
    return row;
  });
  const room = Math.max(0, ROWS_MAX - notes.length);
  return { rows: [...lines.slice(0, room), ...notes] };
};

// service/warm.ts
var createWarmer = (options) => (snapshot) => {
  const up = snapshot.sandboxes.filter((sandbox) => isUpState(sandbox.state)).map((sandbox) => sandbox.id);
  options.desktop.warm(up);
  for (const id of up)
    options.sessions.check(id);
  const valid = new Set(snapshot.sandboxes.map((sandbox) => sandbox.id));
  options.desktop.sweep(valid);
  options.sessions.sweep(valid);
  options.planNote.refresh();
  options.marker.sync(snapshot);
  options.instructions.sync(snapshot);
};

// service/context.ts
var TTL = {
  sandboxes: 4000,
  sessions: 3000,
  sessionCheck: 20000,
  desktop: 5 * 60000,
  environments: 60000,
  remotes: 5 * 60000,
  limits: 5 * 60000,
  instructionsRetry: 30000
};
var FOLLOWERS = { ttlMs: 120000, sweepMs: 30000, flushMs: 250 };
var createServiceContext = (host) => {
  const desktop = createDesktopLinks({ ttlMs: TTL.desktop });
  const planNote = createPlanNote({ ttlMs: TTL.limits });
  const instructions = createInstructionsWriter({
    setInstructions: host.setInstructions,
    retryMs: TTL.instructionsRetry
  });
  const environments = createEnvironmentList({ ttlMs: TTL.environments, load: listEnvironments });
  const remotes = createRemoteCache({ ttlMs: TTL.remotes });
  const ranking = createProjectRanking();
  const scoper = createScoper({ environments, remotes, ranking });
  const projects = createProjectRegistry({
    file: process.env.BOAT_PROJECTS_FILE?.trim() || undefined
  });
  const opencode = createOpencodeConnections();
  const sessions = createOpencodeSessions({
    connections: opencode,
    ttlMs: TTL.sessions,
    checkMs: TTL.sessionCheck
  });
  const marker = createMarker({ projects, scoper, sessions, setMark: host.setMark });
  const sandboxes = createSandboxList({
    ttlMs: TTL.sandboxes,
    load: listSandboxes,
    onSnapshot: createWarmer({ sessions, desktop, planNote, instructions, marker })
  });
  const opencodeFollowers = createOpencodeFollowers({
    connections: opencode,
    sink: host.emit,
    ...FOLLOWERS
  });
  const forgetSandbox = (sandboxId) => {
    sessions.forget(sandboxId);
    desktop.forget(sandboxId);
    opencode.forget(sandboxId);
    opencodeFollowers.unwatch(sandboxId);
  };
  const createJobs = createCreateJobs({
    spawn: spawnCreate,
    rename: renameSandbox,
    emit: (progress) => {
      host.emit("boat:create", progress).catch(() => {});
    },
    onCreated: (sandboxId) => {
      forgetSandbox(sandboxId);
      sandboxes.get(true).catch(() => {});
    },
    onReady: (sandboxId) => {
      forgetSandbox(sandboxId);
      sandboxes.get(true).catch(() => {});
    }
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
        instructions.syncProject(directory, buildProjectInstructions(scope.folderName, visible.map((entry) => entry.sandbox), Date.now()));
      }
      return buildStatusView({
        sandboxes: visible.map((entry) => entry.sandbox),
        desktopUrls: desktop.all(),
        busy: sessions.busyAll(),
        failure: snapshot.failure,
        planNote: planNote.current(),
        now: Date.now(),
        scoped: scope.scoped,
        others: scope.others
      });
    },
    refresh: () => sandboxes.get(true),
    forget: forgetSandbox,
    perform: performSandboxAction
  };
};

// service/http.ts
var MAX_BODY_CHARS = 96 * 1024;
var sendReply = (res, reply) => {
  res.writeHead(reply.status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(reply.body));
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
var createRequestContext = (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let pending = null;
  const body = () => {
    pending ??= readBody(req);
    return pending;
  };
  return {
    method: req.method ?? "GET",
    path: url.pathname,
    search: url.searchParams,
    body,
    json: async () => {
      try {
        const parsed = JSON.parse(await body() || "{}");
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    reply: (status, payload) => ({ status, body: payload })
  };
};

// service/routes/create.ts
import { isAbsolute as isAbsolute3 } from "node:path";

// service/domain/snapshots.ts
var listSavedSnapshots = async () => {
  const data = await runBoat("snapshots", [], { timeoutMs: 20000 });
  const rows = isRecord(data) && Array.isArray(data.named) ? data.named : [];
  return rows.filter(isRecord).flatMap((row) => {
    const name = readString(row.name);
    if (!name || readString(row.status) !== "ready")
      return [];
    return [{
      name,
      type: readString(row.type),
      createdAt: readString(row.createdAt),
      sizeBytes: readNumber(row.sizeBytes)
    }];
  }).sort((left, right) => (Date.parse(right.createdAt ?? "") || 0) - (Date.parse(left.createdAt ?? "") || 0));
};

// service/validation.ts
var SANDBOX_ID = /^[a-z]{2,8}_[a-z0-9]{4,40}$/;
var OPENCODE_SESSION_ID = /^ses_[A-Za-z0-9]{6,64}$/;
var OPENCODE_NAME = /^[A-Za-z0-9._:-]{1,100}$/;
var OPENCODE_MODEL_NAME = /^[A-Za-z0-9._:@+[\]()/-]{1,200}$/;
var OPENCODE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;
var MAX_PROMPT_CHARS = 20000;
var MAX_TITLE_CHARS = 200;
var MAX_DIRECTORY_CHARS = 500;
var MAX_PROMPT_FILES = 4;
var MAX_PROMPT_FILE_CHARS = 24000;
var MAX_PROMPT_FILES_CHARS = 48000;
var MAX_PROMPT_BODY_CHARS = 60000;
var IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/;
var BASE64_DATA = /^[A-Za-z0-9+/]+={0,2}$/;
var isSandboxId = (value) => typeof value === "string" && SANDBOX_ID.test(value);
var isOpencodeSessionId = (value) => typeof value === "string" && OPENCODE_SESSION_ID.test(value);
var isOpencodeRequestId = (value) => typeof value === "string" && OPENCODE_REQUEST_ID.test(value);
var isOpencodeName = (value) => typeof value === "string" && OPENCODE_NAME.test(value);
var isAbsoluteDirectory = (value) => typeof value === "string" && value.startsWith("/") && value.length <= MAX_DIRECTORY_CHARS && !value.includes("\x00") && !value.split("/").includes("..");
var readOpencodeModelRef = (value) => {
  if (!isRecord(value))
    return null;
  const id = readString(value.id);
  const providerID = readString(value.providerID);
  if (!id || !providerID || !OPENCODE_MODEL_NAME.test(id) || !OPENCODE_MODEL_NAME.test(providerID))
    return null;
  const variant = readString(value.variant);
  if (variant !== null && !OPENCODE_MODEL_NAME.test(variant))
    return null;
  return { id, providerID, variant };
};
var readPromptFile = (value) => {
  if (!isRecord(value))
    return null;
  const name = readString(value.name);
  const mime = readString(value.mime);
  const data = readString(value.data);
  if (!name || name.length > MAX_TITLE_CHARS)
    return null;
  if (!mime || !IMAGE_MIME.test(mime))
    return null;
  if (!data || data.length > MAX_PROMPT_FILE_CHARS || !BASE64_DATA.test(data))
    return null;
  return { name, mime, data };
};
var readPromptFiles = (value, textChars) => {
  if (value === undefined)
    return { files: [] };
  if (!Array.isArray(value))
    return { error: "Unknown attachment." };
  if (value.length > MAX_PROMPT_FILES) {
    return { error: `At most ${MAX_PROMPT_FILES} images can ride with one message.` };
  }
  const files = [];
  let chars = 0;
  for (const entry of value) {
    const file = readPromptFile(entry);
    if (!file)
      return { error: "Only PNG, JPEG, WebP or GIF images can be attached." };
    chars += file.data.length;
    files.push(file);
  }
  if (chars > MAX_PROMPT_FILES_CHARS || textChars + chars > MAX_PROMPT_BODY_CHARS) {
    return { error: "That message and its images are too large to send together." };
  }
  return { files };
};

// service/create/request.ts
var MAX_NAME_CHARS = 120;
var limitsBlockedReason = (limits) => {
  if (!limits.canStart)
    return limits.blockedReason ?? "The plan cannot start a sandbox right now.";
  if (limits.active !== null && limits.maxActive !== null && limits.active >= limits.maxActive) {
    return `All ${limits.maxActive} sandbox slots are in use. Stop one first.`;
  }
  return null;
};
var readStart = (body) => {
  const start = body.start;
  if (start?.kind === "clean")
    return { kind: "clean" };
  if (start?.kind === "snapshot") {
    const name = readString(start.name);
    return name ? { kind: "snapshot", name } : { error: "Pick a saved snapshot." };
  }
  if (start?.kind === "copy") {
    const sandboxId = readString(start.sandboxId);
    return isSandboxId(sandboxId) ? { kind: "copy", sandboxId } : { error: "Pick a sandbox to copy." };
  }
  return { error: "Pick what the sandbox starts from." };
};
var readCreateRequest = (body, autoStopMaxHours) => {
  if (!body)
    return { ok: false, error: "Unknown create request." };
  const start = readStart(body);
  if ("error" in start)
    return { ok: false, error: start.error };
  const environment = readString(body.environment);
  const size = readString(body.size);
  const name = readString(body.name);
  const hours = typeof body.autoStopHours === "number" && Number.isFinite(body.autoStopHours) ? body.autoStopHours : 1;
  if (size && !isSandboxSize(size))
    return { ok: false, error: "Unknown machine size." };
  if (name && name.length > MAX_NAME_CHARS) {
    return { ok: false, error: `That name is too long (${MAX_NAME_CHARS} characters).` };
  }
  if (!Number.isInteger(hours) || hours < 1 || hours > autoStopMaxHours) {
    return { ok: false, error: `Auto-stop must be between 1 and ${autoStopMaxHours} hours.` };
  }
  return {
    ok: true,
    input: {
      start,
      environment: environment ?? undefined,
      size: size ?? undefined,
      name: name ?? undefined,
      autoStopSeconds: hours * 3600
    }
  };
};

// service/router.ts
var route = (method, path, handler) => ({
  method,
  path,
  handler
});
var createRouter = (routes) => {
  const table = new Map;
  for (const entry of routes) {
    const key = `${entry.method} ${entry.path}`;
    if (table.has(key))
      throw new Error(`Boat service: duplicate route ${key}.`);
    table.set(key, entry.handler);
  }
  return async (context) => table.get(`${context.method} ${context.path}`)?.(context) ?? null;
};

// service/routes/create.ts
var createRoutes = (deps) => [
  route("GET", "/create-options", async (context) => {
    const directory = context.search.get("directory");
    try {
      const [environments, limits, snapshots] = await Promise.all([
        deps.environments.get().catch(() => []),
        readLimits(),
        listSavedSnapshots().catch(() => [])
      ]);
      let suggested = environments.find((environment) => environment.isDefault)?.name ?? null;
      if (directory && isAbsolute3(directory)) {
        const repoSlugs = await deps.remotes.get(directory).catch(() => []);
        suggested = chooseEnvironment(environments, { folderName: folderNameOf(directory), repoSlugs }) ?? suggested;
      }
      const body = {
        environments: environments.map((environment) => ({
          name: environment.name,
          isDefault: environment.isDefault
        })),
        snapshots,
        limits: {
          canStart: limits.canStart,
          reason: limitsBlockedReason(limits),
          active: limits.active,
          maxActive: limits.maxActive,
          autoStopMaxHours: limits.autoStopMaxHours,
          sizes: limits.sizes
        },
        suggestedEnvironment: suggested
      };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/create", async (context) => {
    const body = await context.json();
    if (deps.createJobs.busy()) {
      return context.reply(409, errorBody("A sandbox is already being created."));
    }
    let limits;
    try {
      limits = await readLimits();
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
    const blocked = limitsBlockedReason(limits);
    if (blocked)
      return context.reply(409, errorBody(blocked));
    const request = readCreateRequest(body, limits.autoStopMaxHours);
    if (!request.ok)
      return context.reply(400, errorBody(request.error));
    if (request.input.size) {
      const size = limits.sizes.find((entry) => entry.id === request.input.size);
      if (size && !size.available) {
        return context.reply(409, errorBody(size.reason ?? "That machine size is not available on this plan."));
      }
    }
    try {
      deps.createJobs.start(request.input);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
    const answer = { accepted: true };
    return context.reply(200, answer);
  })
];

// shared/time.ts
var remaining = (iso) => {
  if (!iso)
    return "";
  const milliseconds = Date.parse(iso) - Date.now();
  if (!Number.isFinite(milliseconds))
    return "";
  if (milliseconds <= 0)
    return "stopping";
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  if (minutes < 60)
    return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h left` : `${hours}h ${rest}m left`;
};
var timeAgoAt = (at) => {
  if (!Number.isFinite(at) || at <= 0)
    return "";
  const milliseconds = Date.now() - at;
  if (milliseconds < 60000)
    return "just now";
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 60)
    return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

// service/mentions/render.ts
var MENTION_TEXT_MAX2 = 16000;
var SESSIONS_SHOWN = 10;
var MESSAGES_SHOWN = 40;
var TOOL_DETAIL_MAX = 120;
var sizeOf3 = (sandbox) => {
  const parts = [sandbox.type ?? "default"];
  if (sandbox.memoryGB !== null)
    parts.push(`${sandbox.memoryGB} GB`);
  if (sandbox.vcpu !== null)
    parts.push(`${sandbox.vcpu} vCPU`);
  return parts.join(" · ");
};
var stateOf = (sandbox) => {
  const left = isUpState(sandbox.state) ? remaining(sandbox.archiveAfter) : "";
  return left ? `${sandbox.state} · ${left}` : sandbox.state;
};
var modelOf = (session) => {
  if (!session.model)
    return null;
  return [session.model.providerID, session.model.id, session.model.variant].filter(Boolean).join("/");
};
var sessionLine = (session) => [
  `- \`${session.id}\`: ${session.title ? `"${clip(session.title, 100)}"` : "new session"}`,
  session.status,
  session.directory,
  timeAgoAt(session.updatedAt)
].filter(Boolean).join(" · ");
var renderSandboxMention = (sandbox, sessions) => {
  const lines = [
    `## Sandbox ${sandbox.name} (\`${sandbox.id}\`)`,
    "",
    `- State: ${stateOf(sandbox)}`,
    `- Size: ${sizeOf3(sandbox)}`,
    sandbox.environment ? `- Environment: ${sandbox.environment}` : null,
    `- OpenCode sessions: ${sessions.length}`,
    "",
    sessions.length > 0 ? "**Sessions**" : "_No OpenCode sessions yet._"
  ].filter((line) => line !== null);
  for (const session of sessions.slice(0, SESSIONS_SHOWN))
    lines.push(sessionLine(session));
  if (sessions.length > SESSIONS_SHOWN) {
    lines.push(`- and ${sessions.length - SESSIONS_SHOWN} more.`);
  }
  lines.push("", `Run commands inside it with \`boat exec ${sandbox.id} -- <command>\`.`, "Sandbox agents run in this sandbox's OpenCode server; open them from the Boat panel's Sessions tab (or the row menu's OpenCode item).");
  return clip(lines.join(`
`), MENTION_TEXT_MAX2);
};
var oneLine = (text, max) => clip(text.replace(/\s+/g, " ").trim(), max);
var toolDetail = (tool) => {
  const input = tool.input ?? {};
  for (const key of ["command", "description", "filePath", "path", "pattern"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim())
      return oneLine(value, TOOL_DETAIL_MAX);
  }
  return "";
};
var toolLine = (tool) => {
  const detail = toolDetail(tool);
  const failed = tool.status === "error";
  return `- \`${tool.name}\`${detail ? ` — ${detail}` : ""}${failed ? " (failed)" : ""}`;
};
var textOf = (parts) => parts.flatMap((part) => part.kind === "text" ? [part.text] : []).join(`
`).trim();
var messageLines = (message) => {
  const lines = [];
  const text = textOf(message.parts);
  if (message.role === "user") {
    if (text)
      lines.push(`**You:** ${text}`, "");
    return lines;
  }
  if (text)
    lines.push(text, "");
  for (const part of message.parts) {
    if (part.kind === "tool")
      lines.push(toolLine(part.tool));
  }
  if (message.notice)
    lines.push(`- ${oneLine(message.notice, 400)}`);
  if (message.error)
    lines.push(`> ${oneLine(message.error, 600)}`, "");
  if (lines.length > 0 && lines[lines.length - 1] !== "")
    lines.push("");
  return lines;
};
var renderSessionMention = (input) => {
  const name = input.sandbox?.name ?? input.sandboxId;
  const lines = [
    `## Sandbox ${name} (\`${input.sandboxId}\`) — OpenCode session \`${input.sessionId}\``,
    ""
  ];
  if (input.sandbox) {
    lines.push(`- State: ${stateOf(input.sandbox)}`, `- Size: ${sizeOf3(input.sandbox)}`);
  }
  if (input.session) {
    lines.push(`- Title: ${input.session.title ?? "New session"}`);
    const directory = input.session.directory;
    if (directory)
      lines.push(`- Directory: \`${directory}\``);
    const agent = [input.session.agent, modelOf(input.session)].filter(Boolean).join(" · ");
    if (agent)
      lines.push(`- Agent: ${agent}`);
    lines.push(`- Status: ${input.session.status}`);
  }
  lines.push(`- Commands: \`boat exec ${input.sandboxId} -- <command>\``, "", "**Transcript** (oldest first)", "");
  const header = lines.join(`
`);
  const shown = input.messages.slice(-MESSAGES_SHOWN);
  const omitted = input.messages.length - shown.length;
  const body = [];
  if (omitted > 0)
    body.push(`_${omitted} older messages were left out._`, "");
  for (const message of shown) {
    if (message.role !== "user" && message.role !== "assistant")
      continue;
    body.push(...messageLines(message));
  }
  if (body.length === 0)
    return clip(`${header}_No messages yet._`, MENTION_TEXT_MAX2);
  return clip(`${header}${body.join(`
`)}`, MENTION_TEXT_MAX2);
};

// service/mentions/rows.ts
var MENTION_ROW_MAX = 20;
var MENTION_TEXT_MAX3 = 120;
var mentionSandboxId = (sandboxId) => `sandbox:${sandboxId}`;
var mentionSessionId = (sandboxId, sessionId) => `session:${sandboxId}:${sessionId}`;
var parseMentionId = (id) => {
  if (!id)
    return null;
  const [kind, sandboxId, sessionId] = id.split(":");
  if (!isSandboxId(sandboxId))
    return null;
  if (kind === "sandbox")
    return { kind, sandboxId };
  if (kind === "session" && isOpencodeSessionId(sessionId)) {
    return { kind, sandboxId, sessionId };
  }
  return null;
};
var sessionSubtitle = (sandbox, session) => {
  const agent = session.agent ?? "agent";
  const model = session.model ? `/${session.model.id}` : "";
  return [
    sandbox.name || sandbox.id,
    `${agent}${model}`,
    session.status,
    timeAgoAt(session.updatedAt)
  ].filter(Boolean).join(" · ");
};
var sandboxSubtitle = (sandbox) => {
  const left = isUpState(sandbox.state) ? remaining(sandbox.archiveAfter) : "";
  return [sandbox.name || sandbox.id, sandbox.state, left].filter(Boolean).join(" · ");
};
var matches = (needle, ...fields) => needle.length === 0 || fields.some((field) => field?.toLowerCase().includes(needle));
var mentionRows = (input) => {
  const needle = input.query.trim().toLowerCase();
  const sandboxes = [...input.sandboxes].sort((left, right) => {
    const project = Number(!input.projectIds?.has(left.id)) - Number(!input.projectIds?.has(right.id));
    if (project !== 0)
      return project;
    const up = Number(!isUpState(left.state)) - Number(!isUpState(right.state));
    if (up !== 0)
      return up;
    return (left.name || left.id).localeCompare(right.name || right.id);
  });
  const rows = [];
  for (const sandbox of sandboxes) {
    const sessions = [...input.sessions(sandbox.id) ?? []].sort((left, right) => Number(right.status === "busy") - Number(left.status === "busy") || right.updatedAt - left.updatedAt);
    for (const session of sessions) {
      const title = clip(session.title ?? "New session", MENTION_TEXT_MAX3);
      const subtitle = clip(sessionSubtitle(sandbox, session), MENTION_TEXT_MAX3);
      if (!matches(needle, title, subtitle, sandbox.id, session.id))
        continue;
      rows.push({ id: mentionSessionId(sandbox.id, session.id), title, subtitle });
      if (rows.length >= MENTION_ROW_MAX)
        return rows;
    }
    const title = "Sandbox overview";
    const subtitle = clip(sandboxSubtitle(sandbox), MENTION_TEXT_MAX3);
    if (!matches(needle, title, subtitle, sandbox.id, sandbox.environment))
      continue;
    rows.push({ id: mentionSandboxId(sandbox.id), title, subtitle });
    if (rows.length >= MENTION_ROW_MAX)
      return rows;
  }
  return rows;
};

// service/routes/mentions.ts
var mentionRoutes = (deps) => [
  route("POST", MENTIONS_SEARCH_PATH, async (context) => {
    const body = await context.json();
    const directory = readString(body?.directory);
    try {
      const snapshot = deps.sandboxes.peek() ?? await deps.sandboxes.get();
      for (const sandbox of snapshot.sandboxes) {
        if (isUpState(sandbox.state))
          deps.sessions.check(sandbox.id);
      }
      const items = mentionRows({
        sandboxes: snapshot.sandboxes,
        sessions: (sandboxId) => deps.sessions.peek(sandboxId),
        projectIds: directory ? deps.ranking.projectIds(directory) : null,
        query: readString(body?.query) ?? ""
      });
      const answer = { items };
      return context.reply(200, answer);
    } catch {
      const answer = { items: [] };
      return context.reply(200, answer);
    }
  }),
  route("POST", MENTIONS_RESOLVE_PATH, async (context) => {
    const body = await context.json();
    const mention = parseMentionId(readString(body?.id));
    if (!mention)
      return context.reply(400, { error: "Unknown mention." });
    const snapshot = deps.sandboxes.peek() ?? await deps.sandboxes.get();
    const sandbox = snapshot.sandboxes.find((entry) => entry.id === mention.sandboxId) ?? null;
    try {
      if (mention.kind === "sandbox") {
        if (!sandbox)
          return context.reply(404, { error: "That sandbox is not in the list any more." });
        const sessions = deps.sessions.peek(sandbox.id) ?? await deps.sessions.get(sandbox.id);
        const answer = { text: renderSandboxMention(sandbox, sessions) };
        return context.reply(200, answer);
      }
      const history = await deps.opencode.run(mention.sandboxId, async (connection) => {
        const session = await readSession(connection, mention.sessionId);
        if (!session)
          throw new Error("That OpenCode session no longer exists.");
        return { session, ...await readSessionMessages(connection, mention.sessionId) };
      });
      const answer = {
        text: renderSessionMention({
          sandbox,
          sandboxId: mention.sandboxId,
          sessionId: mention.sessionId,
          session: history.session,
          messages: history.messages
        })
      };
      return context.reply(200, answer);
    } catch (failure) {
      return context.reply(502, { error: describeFailure(failure).text });
    }
  })
];

// service/routes/opencode-catalog.ts
var opencodeCatalogRoutes = (deps) => [
  route("GET", "/opencode/catalog", async (context) => {
    const sandboxId = context.search.get("sandbox");
    if (!isSandboxId(sandboxId))
      return context.reply(400, errorBody("Unknown sandbox id."));
    try {
      const result = await deps.opencode.run(sandboxId, async (connection) => ({
        ...await readCatalog(connection),
        directory: connection.directory,
        directories: connection.directories
      }));
      const body = { ...result, now: Date.now() };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  })
];

// service/routes/opencode-chat.ts
var isDecision = (value) => value === "once" || value === "always" || value === "reject";
var isDelivery = (value) => value === "steer" || value === "queue";
var promptFiles = (files) => files.map((file) => ({
  uri: `data:${file.mime};base64,${file.data}`,
  source: { type: "inline" },
  name: file.name
}));
var sameModel = (left, right) => left !== null && left.id === right.id && left.providerID === right.providerID && (right.variant === null || left.variant === right.variant);
var readAnswer = (value) => {
  if (!isRecord(value))
    return null;
  const answer = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(key))
      continue;
    if (typeof entry === "string") {
      if (entry.length <= 5000)
        answer[key] = entry;
    } else if (typeof entry === "number") {
      if (Number.isFinite(entry))
        answer[key] = entry;
    } else if (typeof entry === "boolean") {
      answer[key] = entry;
    } else if (Array.isArray(entry)) {
      const items = entry.filter((item) => typeof item === "string" && item.length <= 5000);
      if (items.length === entry.length)
        answer[key] = items;
    }
  }
  return Object.keys(answer).length > 0 ? answer : null;
};
var opencodeChatRoutes = (deps) => [
  route("POST", "/opencode/prompt", async (context) => {
    const body = await context.json();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    const text = readString(body?.text) ?? "";
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId)) {
      return context.reply(400, errorBody("Unknown sandbox or session."));
    }
    if (text.length > MAX_PROMPT_CHARS)
      return context.reply(400, errorBody("That prompt is too long."));
    const read = readPromptFiles(body?.files, text.length);
    if ("error" in read)
      return context.reply(400, errorBody(read.error));
    const files = read.files;
    if (!text && files.length === 0)
      return context.reply(400, errorBody("Write a prompt first."));
    const delivery = body?.delivery === undefined ? null : body.delivery;
    if (delivery !== null && !isDelivery(delivery)) {
      return context.reply(400, errorBody("Unknown delivery."));
    }
    const agent = readString(body?.agent);
    if (agent && !isOpencodeName(agent))
      return context.reply(400, errorBody("Unknown agent."));
    const model = body?.model === undefined ? null : readOpencodeModelRef(body.model);
    if (body?.model !== undefined && !model) {
      return context.reply(400, errorBody("Unknown model."));
    }
    try {
      const messageID = await deps.opencode.run(sandboxId, async (connection) => {
        if (agent || model) {
          const raw = await connection.client.session.get({ sessionID: sessionId });
          const current = normalizeSession(raw);
          if (agent && current?.agent !== agent) {
            await connection.client.session.switchAgent({ sessionID: sessionId, agent });
          }
          if (model && !sameModel(current?.model ?? null, model)) {
            await connection.client.session.switchModel({ sessionID: sessionId, model: toModelRefInput(model) });
          }
        }
        const raw = await connection.client.session.prompt({
          sessionID: sessionId,
          text,
          ...files.length > 0 ? { files: promptFiles(files) } : {},
          ...delivery ? { delivery } : {}
        });
        return isRecord(raw) ? readString(raw.id) : null;
      });
      const answer = { ok: true, sessionID: sessionId, messageID };
      return context.reply(200, answer);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/opencode/abort", async (context) => {
    const body = await context.json();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId)) {
      return context.reply(400, errorBody("Unknown sandbox or session."));
    }
    try {
      const interrupted = await deps.opencode.run(sandboxId, async (connection) => {
        const raw = await connection.client.session.interrupt({ sessionID: sessionId });
        return isRecord(raw) && raw.interrupted === true;
      });
      const answer = { ok: true, interrupted };
      return context.reply(200, answer);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/opencode/permission", async (context) => {
    const body = await context.json();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    const requestId = readString(body?.request);
    const decision = body?.decision;
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId) || !isOpencodeRequestId(requestId)) {
      return context.reply(400, errorBody("Unknown sandbox, session or request."));
    }
    if (!isDecision(decision))
      return context.reply(400, errorBody("Unknown permission decision."));
    const message = readString(body?.message);
    try {
      await deps.opencode.run(sandboxId, async (connection) => {
        await connection.client.permission.reply({
          sessionID: sessionId,
          requestID: requestId,
          decision,
          ...message ? { message } : {}
        });
      });
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/opencode/question", async (context) => {
    const body = await context.json();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    const questionId = readString(body?.question);
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId) || !isOpencodeRequestId(questionId)) {
      return context.reply(400, errorBody("Unknown sandbox, session or question."));
    }
    const answer = readAnswer(body?.answer);
    if (!answer)
      return context.reply(400, errorBody("Answer at least one question field."));
    try {
      await deps.opencode.run(sandboxId, async (connection) => {
        await connection.client.session.form.reply({ sessionID: sessionId, formID: questionId, answer });
      });
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  })
];

// service/routes/opencode-events.ts
var opencodeEventRoutes = (deps) => [
  route("POST", "/opencode/watch", async (context) => {
    const body = await context.json();
    if (!body || !isSandboxId(body.sandbox)) {
      return context.reply(400, errorBody("Unknown sandbox id."));
    }
    try {
      deps.opencodeFollowers.watch(body.sandbox);
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/opencode/unwatch", async (context) => {
    const body = await context.json();
    if (body && isSandboxId(body.sandbox))
      deps.opencodeFollowers.unwatch(body.sandbox);
    const answer = { ok: true };
    return context.reply(200, answer);
  })
];

// service/routes/opencode-inbox.ts
var opencodeInboxRoutes = (deps) => [
  route("GET", "/opencode/inbox", async (context) => {
    const sandboxId = context.search.get("sandbox");
    const sessionId = context.search.get("session");
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId)) {
      return context.reply(400, errorBody("Unknown sandbox or session."));
    }
    try {
      const entries = await deps.opencode.run(sandboxId, (connection) => readInbox(connection, sessionId));
      const body = { entries, now: Date.now() };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/opencode/inbox/cancel", async (context) => {
    const body = await context.json();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    const inboxId = readString(body?.inbox);
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId) || !isOpencodeRequestId(inboxId)) {
      return context.reply(400, errorBody("Unknown sandbox, session or inbox entry."));
    }
    try {
      await deps.opencode.run(sandboxId, (connection) => connection.client.session.inbox.cancel({ sessionID: sessionId, inboxID: inboxId }));
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/opencode/inbox/update", async (context) => {
    const body = await context.json();
    const sandboxId = readString(body?.sandbox);
    const sessionId = readString(body?.session);
    const inboxId = readString(body?.inbox);
    const delivery = body?.delivery;
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId) || !isOpencodeRequestId(inboxId)) {
      return context.reply(400, errorBody("Unknown sandbox, session or inbox entry."));
    }
    if (delivery !== "steer" && delivery !== "queue") {
      return context.reply(400, errorBody("Unknown delivery."));
    }
    try {
      await deps.opencode.run(sandboxId, (connection) => connection.client.session.inbox.update({ sessionID: sessionId, inboxID: inboxId, delivery }));
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  })
];

// service/routes/opencode-sessions.ts
var opencodeSessionRoutes = (deps) => [
  route("GET", "/opencode/sessions", async (context) => {
    const sandboxId = context.search.get("sandbox");
    if (!isSandboxId(sandboxId))
      return context.reply(400, errorBody("Unknown sandbox id."));
    const requested = context.search.get("directory");
    if (requested !== null && !isAbsoluteDirectory(requested)) {
      return context.reply(400, errorBody("Unknown directory."));
    }
    try {
      const result = await deps.opencode.run(sandboxId, async (connection) => ({
        sessions: await readSessions(connection, requested),
        directory: connection.directory,
        directories: connection.directories
      }));
      const body = { ...result, now: Date.now() };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("GET", "/opencode/messages", async (context) => {
    const sandboxId = context.search.get("sandbox");
    const sessionId = context.search.get("session");
    if (!isSandboxId(sandboxId) || !isOpencodeSessionId(sessionId)) {
      return context.reply(400, errorBody("Unknown sandbox or session."));
    }
    try {
      const result = await deps.opencode.run(sandboxId, async (connection) => {
        const session = await readSession(connection, sessionId);
        if (!session)
          throw new Error("That OpenCode session no longer exists.");
        const [history, permissions, questions, inbox] = await Promise.all([
          readSessionMessages(connection, sessionId),
          readPermissions(connection, sessionId),
          readQuestions(connection, sessionId),
          readInbox(connection, sessionId)
        ]);
        return { session, ...history, permissions, questions, inbox };
      });
      const body = { ...result, now: Date.now() };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/opencode/session", async (context) => {
    const body = await context.json();
    const sandboxId = readString(body?.sandbox);
    if (!isSandboxId(sandboxId))
      return context.reply(400, errorBody("Unknown sandbox id."));
    const directory = readString(body?.directory);
    if (directory !== null && !isAbsoluteDirectory(directory)) {
      return context.reply(400, errorBody("Unknown directory."));
    }
    const title = readString(body?.title);
    if (title && title.length > MAX_TITLE_CHARS) {
      return context.reply(400, errorBody("That session title is too long."));
    }
    const agent = readString(body?.agent);
    if (agent && !isOpencodeName(agent))
      return context.reply(400, errorBody("Unknown agent."));
    const model = body?.model === undefined ? null : readOpencodeModelRef(body.model);
    if (body?.model !== undefined && !model) {
      return context.reply(400, errorBody("Unknown model."));
    }
    try {
      const session = await deps.opencode.run(sandboxId, async (connection) => {
        const raw = await connection.client.session.create({
          ...title ? { title } : {},
          ...agent ? { agent } : {},
          ...model ? { model: toModelRefInput(model) } : {},
          location: { directory: directory ?? connection.directory }
        });
        return normalizeSession(raw);
      });
      if (!session)
        throw new Error("OpenCode created a session with no id.");
      const answer = { session };
      return context.reply(200, answer);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  })
];

// service/routes/projects.ts
var projectRoutes = (deps) => [
  route("POST", "/projects", async (context) => {
    const body = await context.json();
    const directories = Array.isArray(body?.directories) ? body.directories.filter((entry) => typeof entry === "string") : [];
    if (deps.projects.replace(directories))
      deps.onChanged();
    return context.reply(200, { ok: true });
  })
];

// service/routes/sandboxes.ts
var summaryOf = (sandbox) => ({
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
  desktopAvailable: sandbox.desktopAvailable
});
var isLifecycleAction = (action) => action === "stop" || action === "resume" || action === "extend";
var sandboxRoutes = (deps) => [
  route("GET", "/sandboxes", async (context) => {
    const directory = context.search.get("directory");
    if (directory)
      deps.projects.remember([directory]);
    const snapshot = await deps.sandboxes.get();
    const scope = await deps.scoper.apply(snapshot.sandboxes, directory);
    const ordered = [...scope.entries].sort((left, right) => Number(right.inProject) - Number(left.inProject));
    const body = {
      sandboxes: ordered.map((entry) => ({
        ...summaryOf(entry.sandbox),
        matchedBy: entry.matchedBy,
        inProject: entry.inProject,
        agentRunning: deps.sessions.busy(entry.sandbox.id)
      })),
      error: snapshot.failure?.text ?? null,
      now: Date.now(),
      projectScoped: scope.scoped
    };
    return context.reply(200, body);
  }),
  route("POST", "/action", async (context) => {
    const body = await context.json();
    const sandboxId = readString(body?.sandbox);
    const action = readString(body?.action);
    if (!isSandboxId(sandboxId) || !action)
      return context.reply(400, errorBody("Unknown sandbox or action."));
    const snapshot = await deps.sandboxes.get();
    const sandbox = snapshot.sandboxes.find((candidate) => candidate.id === sandboxId);
    if (!sandbox)
      return context.reply(404, errorBody("That sandbox is not in the list any more."));
    if (action === "desktop") {
      try {
        const url = await deps.desktop.get(sandboxId);
        if (!url)
          return context.reply(502, errorBody("This sandbox has no desktop to open."));
        const answer = { ok: true, url };
        return context.reply(200, answer);
      } catch (failure) {
        return context.reply(502, errorBody(describeFailure(failure).text));
      }
    }
    if (action === "opencode") {
      try {
        const answer = { ok: true, url: await openOpencodeUrl(sandboxId) };
        return context.reply(200, answer);
      } catch (failure) {
        return context.reply(502, errorBody(describeFailure(failure).text));
      }
    }
    if (!isLifecycleAction(action))
      return context.reply(400, errorBody("Unknown sandbox action."));
    try {
      await deps.perform(action, sandbox);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
    deps.forget(sandboxId);
    await deps.refresh();
    return context.reply(200, { ok: true });
  })
];

// service/routes/schedule.ts
var scheduleRoutes = (options) => [
  route("POST", "/schedule", async (context) => {
    if (!readServiceScheduleRequest(await context.body()))
      return context.reply(400, {});
    options.onWake();
    return context.reply(200, { ok: true });
  })
];

// service/routes/status.ts
var statusRoutes = (deps) => [
  route("GET", "/status", async (context) => {
    const directory = context.search.get("directory");
    if (directory)
      deps.projects.remember([directory]);
    try {
      return context.reply(200, await deps.statusView(directory));
    } catch (failure) {
      return context.reply(200, {
        rows: [{ kind: "note", id: "note-error", text: describeFailure(failure).text, tone: "error" }]
      });
    }
  }),
  route("POST", "/status", async (context) => {
    const snapshot = await deps.sandboxes.get();
    const action = readStatusAction(await context.body(), snapshot.sandboxes);
    if (!action)
      return context.reply(422, { message: "That control is no longer recognised. Reopen the section." });
    const sandbox = snapshot.sandboxes.find((candidate) => candidate.id === action.sandboxId);
    if (!sandbox)
      return context.reply(422, { message: "That sandbox is not in the list any more." });
    try {
      await deps.perform(action.verb, sandbox);
    } catch (failure) {
      return context.reply(502, { message: describeFailure(failure).text });
    }
    deps.forget(action.sandboxId);
    await deps.refresh();
    return context.reply(200, {});
  })
];

// service/main.ts
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
var context = createServiceContext({
  setInstructions: (directory, text) => host.setInstructions(directory, text),
  emit: (topic, data) => host.emit(topic, data),
  setMark: (target, mark) => host.setMark(target, mark)
});
var route2 = createRouter([
  ...statusRoutes(context),
  ...sandboxRoutes(context),
  ...createRoutes(context),
  ...opencodeSessionRoutes(context),
  ...opencodeChatRoutes(context),
  ...opencodeInboxRoutes(context),
  ...opencodeCatalogRoutes(context),
  ...opencodeEventRoutes(context),
  ...mentionRoutes(context),
  ...projectRoutes({
    projects: context.projects,
    onChanged: () => {
      context.refresh().catch(() => {});
    }
  }),
  ...scheduleRoutes({
    onWake: () => {
      context.refresh().catch(() => {});
    }
  })
]);
var server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
    return;
  }
  const request = createRequestContext(req, res);
  if (request.path === "/health") {
    sendReply(res, request.reply(200, {}));
    return;
  }
  route2(request).then((reply) => {
    sendReply(res, reply ?? request.reply(404, {}));
  }, (failure) => {
    console.error("Boat:", failure instanceof Error ? failure.message : failure);
    if (res.headersSent)
      res.end();
    else
      sendReply(res, request.reply(500, { error: "Boat could not answer." }));
  });
});
server.listen(port, "127.0.0.1", () => {
  installFollowerCleanup(context.opencodeFollowers);
  context.refresh().catch(() => {});
});
process.on("unhandledRejection", (reason) => {
  console.error("Boat:", reason instanceof Error ? reason.message : reason);
});
