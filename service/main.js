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

// shared/json.ts
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var readString = (value) => typeof value === "string" && value.trim().length > 0 ? value : null;
var readNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
var clip = (text, max) => text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

// service/boat.ts
import { execFile, spawn } from "node:child_process";
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
var errorMessage = (stdout, stderr, fallback) => {
  const parsed = parseBoatJson(stdout) ?? parseBoatJson(stderr);
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

// service/domain/conversations.ts
var listConversations = async (sandboxId) => {
  const data = await runBoat("conversations", [sandboxId], { timeoutMs: 15000 });
  const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.conversations) ? data.conversations : [];
  return rows.filter(isRecord).flatMap((row) => {
    const id = readString(row.id) ?? readString(row.conversationId);
    if (!id)
      return [];
    return [{
      id,
      createdAt: readString(row.createdAt),
      lastPromptAt: readString(row.lastPromptAt),
      prompts: readNumber(row.prompts) ?? 0,
      running: row.running === true,
      lastHarness: readString(row.lastHarness) ?? readString(row.harness),
      lastModel: readString(row.lastModel) ?? readString(row.model),
      lastPromptPreview: readString(row.lastPromptPreview) ?? readString(row.lastPrompt),
      current: row.current === true
    }];
  });
};

// service/data/conversation-list.ts
var createConversationList = (options) => {
  const entries = new Map;
  return {
    get: async (sandboxId, readOptions = {}) => {
      const cached = entries.get(sandboxId);
      if (!readOptions.force && cached && Date.now() - cached.at < options.ttlMs)
        return cached.conversations;
      const conversations = await listConversations(sandboxId);
      entries.set(sandboxId, { at: Date.now(), conversations });
      return conversations;
    },
    peek: (sandboxId) => entries.get(sandboxId)?.conversations ?? null,
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

// service/domain/limits.ts
var readLimits = async () => {
  const data = await runBoat("limits", [], { timeoutMs: 15000 });
  const record = isRecord(data) ? data : {};
  return {
    canStart: record.canStart !== false,
    blockedReason: readString(record.blockedReason) ?? readString(record.startBlockedReason),
    active: readNumber(record.activeSandboxes),
    maxActive: readNumber(record.maxActiveSandboxes)
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

// service/data/running-agents.ts
var createRunningAgents = (options) => {
  const running = new Set;
  const checkedAt = new Map;
  return {
    check: (sandboxId) => {
      const now = Date.now();
      if (now - (checkedAt.get(sandboxId) ?? 0) < options.ttlMs)
        return;
      checkedAt.set(sandboxId, now);
      options.conversations.get(sandboxId, { force: true }).then((conversations) => {
        if (conversations.some((conversation) => conversation.running))
          running.add(sandboxId);
        else
          running.delete(sandboxId);
      }, () => {});
    },
    has: (sandboxId) => running.has(sandboxId),
    all: () => running,
    forget: (sandboxId) => {
      running.delete(sandboxId);
      checkedAt.delete(sandboxId);
    },
    sweep: (valid) => {
      for (const id of [...running])
        if (!valid.has(id))
          running.delete(id);
      for (const id of [...checkedAt.keys()])
        if (!valid.has(id))
          checkedAt.delete(id);
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
    summaries.push({ name, repos });
  }
  return summaries;
};

// service/followers.ts
import readline from "node:readline";

// service/domain/events.ts
var TEXT_MAX = 20000;
var TOOL_DETAIL_MAX = 300;
var TOOLS_MAX = 40;
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
var toolDetail = (input) => {
  if (input === undefined || input === null)
    return "";
  if (isRecord(input)) {
    const command = readString(input.command) ?? readString(input.cmd);
    if (command)
      return clip(command, TOOL_DETAIL_MAX);
    const path = readString(input.path) ?? readString(input.file_path) ?? readString(input.filePath);
    if (path)
      return clip(path, TOOL_DETAIL_MAX);
  }
  try {
    return clip(JSON.stringify(input), TOOL_DETAIL_MAX);
  } catch {
    return "";
  }
};
var readTools = (value) => {
  if (!Array.isArray(value))
    return [];
  return value.slice(0, TOOLS_MAX).flatMap((entry) => {
    if (!isRecord(entry))
      return [];
    const use = isRecord(entry.use) ? entry.use : null;
    const result = isRecord(entry.result) ? entry.result : null;
    return [{
      name: readString(use?.name) ?? readString(use?.type) ?? "tool",
      detail: toolDetail(use?.input),
      isError: result?.is_error === true
    }];
  });
};
var normalizeEvent = (raw, fallbackConversation = null) => {
  if (!isRecord(raw))
    return null;
  const id = readString(raw.id) ?? readString(raw.eventId);
  if (!id)
    return null;
  const type = readString(raw.type) ?? readString(raw.event) ?? "event";
  const data = isRecord(raw.data) ? raw.data : {};
  const base = {
    id,
    type,
    at: readTimestamp(raw.timestamp) || Date.now(),
    text: "",
    streaming: false,
    model: null,
    status: null,
    tools: [],
    error: null,
    conversationId: readString(raw.conversationId) ?? readString(data.conversationId) ?? fallbackConversation
  };
  if (type === "prompt") {
    const status = readString(data.status);
    const failed = status === "failed" || status === "error";
    return {
      ...base,
      role: "user",
      text: clip(readString(data.prompt) ?? readString(data.message) ?? "", TEXT_MAX),
      status,
      error: failed ? readString(data.error) ?? readString(data.message) ?? "The turn failed." : null
    };
  }
  if (type === "response") {
    return {
      ...base,
      role: "assistant",
      text: clip(readString(data.content) ?? "", TEXT_MAX),
      streaming: data.is_streaming === true,
      model: readString(data.model),
      tools: readTools(data.tools),
      error: readString(data.error)
    };
  }
  if (type === "steer") {
    return {
      ...base,
      role: "user",
      text: clip(readString(data.message) ?? readString(data.prompt) ?? readString(data.content) ?? "", TEXT_MAX),
      status: readString(data.mode) ?? "steer"
    };
  }
  if (type === "error" || type === "sandbox.error") {
    const message = readString(data.message) ?? readString(data.error) ?? readString(raw.error) ?? "The agent failed.";
    return { ...base, role: "system", text: clip(message, TEXT_MAX), error: message };
  }
  const text = readString(data.content) ?? readString(data.message) ?? "";
  return {
    ...base,
    role: text ? "assistant" : "system",
    text: clip(text, TEXT_MAX),
    error: readString(data.error)
  };
};
var listEvents = async (sandboxId, conversationId) => {
  const data = await runBoat("events", [sandboxId, "--convo", conversationId], { timeoutMs: 30000 });
  const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.events) ? data.events : [];
  return rows.flatMap((row) => {
    const event = normalizeEvent(row, conversationId);
    return event ? [event] : [];
  });
};
var eventSize = (event) => 200 + event.text.length + event.tools.reduce((total, tool) => total + tool.name.length + tool.detail.length + 32, 0);

// service/followers.ts
var MAX_BATCH_EVENTS = 40;
var MAX_BATCH_CHARS = 36000;
var keyOf = (sandboxId, conversationId) => `${sandboxId}:${conversationId}`;
var createFollowers = (options) => {
  const followers = new Map;
  let sweeper = null;
  const send = (topic, data) => {
    try {
      Promise.resolve(options.sink(topic, data)).catch(() => {});
    } catch {}
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
      send("boat:events", {
        sandbox: follower.sandboxId,
        conversation: follower.conversationId,
        events: batch
      });
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
    if (follower.flushTimer) {
      clearTimeout(follower.flushTimer);
      follower.flushTimer = null;
    }
    followers.delete(follower.key);
    const child = follower.child;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }, 2000).unref();
    }
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
  return {
    watch: (sandboxId, conversationId) => {
      const key = keyOf(sandboxId, conversationId);
      const existing = followers.get(key);
      if (existing) {
        existing.lastPing = Date.now();
        return;
      }
      const child = spawnBoat("events", [sandboxId, "--convo", conversationId, "--follow"]);
      const stdout = child.stdout;
      if (!stdout) {
        child.kill("SIGTERM");
        throw new BoatError("command-failed", "boat events did not open its output.");
      }
      const follower = {
        key,
        sandboxId,
        conversationId,
        child,
        lastPing: Date.now(),
        buffer: [],
        flushTimer: null,
        stderr: "",
        stopped: false
      };
      followers.set(key, follower);
      ensureSweeper();
      const lines = readline.createInterface({ input: stdout });
      lines.on("line", (line) => {
        const event = normalizeEvent(parseBoatJson(line), conversationId);
        if (event)
          queue(follower, event);
      });
      child.stderr?.on("data", (chunk) => {
        follower.stderr = `${follower.stderr}${String(chunk)}`.slice(-1000);
      });
      child.on("spawn", () => {
        send("boat:stream", { sandbox: sandboxId, conversation: conversationId, state: "live" });
      });
      child.on("error", (error) => {
        send("boat:stream", {
          sandbox: sandboxId,
          conversation: conversationId,
          state: "error",
          message: error.message
        });
        dispose(follower);
      });
      child.on("close", (code) => {
        if (follower.stopped) {
          followers.delete(key);
          return;
        }
        flush(follower);
        const detail = follower.stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-1)[0] ?? null;
        send("boat:stream", {
          sandbox: sandboxId,
          conversation: conversationId,
          state: "ended",
          message: detail ?? (code === 0 ? null : `boat events exited with code ${code ?? "unknown"}.`)
        });
        follower.stopped = true;
        if (follower.flushTimer)
          clearTimeout(follower.flushTimer);
        followers.delete(key);
      });
    },
    unwatch: (sandboxId, conversationId) => {
      const follower = followers.get(keyOf(sandboxId, conversationId));
      if (follower)
        dispose(follower);
    },
    stopAll: () => {
      for (const follower of [...followers.values()])
        dispose(follower);
    }
  };
};
var installFollowerCleanup = (followers) => {
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      followers.stopAll();
      process.exit(0);
    });
  }
  process.on("exit", () => followers.stopAll());
};

// shared/types.ts
var isUpState = (state) => state === "ready" || state === "idle" || state === "running";
var isBootingState = (state) => state === "provisioned" || state === "cloning";
var isPendingState = (state) => isBootingState(state) || state === "stopping";
var isStoppedState = (state) => state === "stopped";

// service/status/text.ts
var TEXT_MAX2 = 4000;
var SANDBOXES_SHOWN = 12;
var COMMANDS_LINE = 'Run commands with `boat exec <id> -- <command>`. Ask a sandbox agent with `boat prompt <id> --provider <claude|codex|opencode|pi|kimi|mistral|prime> --model <model> [--new | --resume <conversation>] "<text>"`; add to a running turn with `boat steer <id> --convo <conversation> "<text>"`, stop it with `boat interrupt <id>`. Pass `--json --no-update` to every command.';
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
`), TEXT_MAX2);
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
`), TEXT_MAX2);
};

// service/instructions.ts
var MAX_PROJECTS = 8;
var createInstructionsWriter = (options) => {
  let globalSent = null;
  let globalRetryAt = 0;
  const projectSent = new Map;
  const projectRetryAt = new Map;
  const rememberProject = (directory, text) => {
    projectSent.delete(directory);
    projectSent.set(directory, text);
    if (projectSent.size <= MAX_PROJECTS)
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
import { isAbsolute } from "node:path";

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

// service/project/scope.ts
var usableDirectory = (directory) => directory && isAbsolute(directory) && !directory.includes("\x00") ? directory : null;
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
    const byAgent = Number(input.agents.has(right.id)) - Number(input.agents.has(left.id));
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

// service/warm.ts
var createWarmer = (options) => (snapshot) => {
  const up = snapshot.sandboxes.filter((sandbox) => isUpState(sandbox.state)).map((sandbox) => sandbox.id);
  options.desktop.warm(up);
  for (const id of up)
    options.agents.check(id);
  const valid = new Set(snapshot.sandboxes.map((sandbox) => sandbox.id));
  options.desktop.sweep(valid);
  options.agents.sweep(valid);
  options.conversations.sweep(valid);
  options.planNote.refresh();
  options.instructions.sync(snapshot);
};

// service/context.ts
var TTL = {
  sandboxes: 4000,
  conversations: 2000,
  desktop: 5 * 60000,
  agents: 20000,
  environments: 60000,
  remotes: 5 * 60000,
  limits: 5 * 60000,
  instructionsRetry: 30000
};
var FOLLOWERS = { ttlMs: 120000, sweepMs: 30000, flushMs: 250 };
var createServiceContext = (host) => {
  const conversations = createConversationList({ ttlMs: TTL.conversations });
  const desktop = createDesktopLinks({ ttlMs: TTL.desktop });
  const agents = createRunningAgents({ ttlMs: TTL.agents, conversations });
  const planNote = createPlanNote({ ttlMs: TTL.limits });
  const instructions = createInstructionsWriter({
    setInstructions: host.setInstructions,
    retryMs: TTL.instructionsRetry
  });
  const sandboxes = createSandboxList({
    ttlMs: TTL.sandboxes,
    load: listSandboxes,
    onSnapshot: createWarmer({ conversations, desktop, agents, planNote, instructions })
  });
  const followers = createFollowers({ sink: host.emit, ...FOLLOWERS });
  const environments = createEnvironmentList({ ttlMs: TTL.environments, load: listEnvironments });
  const scoper = createScoper({
    environments,
    remotes: createRemoteCache({ ttlMs: TTL.remotes })
  });
  return {
    sandboxes,
    conversations,
    desktop,
    agents,
    followers,
    scoper,
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
        agents: agents.all(),
        failure: snapshot.failure,
        planNote: planNote.current(),
        now: Date.now(),
        scoped: scope.scoped,
        others: scope.others
      });
    },
    refresh: () => sandboxes.get(true),
    forget: (sandboxId) => {
      conversations.forget(sandboxId);
      agents.forget(sandboxId);
      desktop.forget(sandboxId);
    },
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

// shared/agent.ts
var AGENT_PROVIDERS = ["claude", "codex", "pi", "opencode", "prime", "kimi", "mistral"];
var isAgentProvider = (value) => AGENT_PROVIDERS.includes(value);

// service/domain/agent.ts
import readline2 from "node:readline";
var MUTATION_TIMEOUT_MS2 = 20000;
var EARLY_RETURN_MS = 2500;
var promptSandbox = (sandboxId, text, options) => new Promise((resolve, reject) => {
  const args = [sandboxId];
  if (options.newConversation)
    args.push("--new");
  if (options.conversation)
    args.push("--resume", options.conversation);
  if (options.provider)
    args.push("--provider", options.provider);
  if (options.model)
    args.push("--model", options.model);
  args.push("--", text);
  const child = spawnBoat("prompt", args);
  const stdout = child.stdout;
  if (!stdout) {
    child.kill("SIGTERM");
    reject(new BoatError("command-failed", "boat prompt did not open its output."));
    return;
  }
  let conversationId = null;
  let stdoutError = null;
  let stderr = "";
  let settled = false;
  const finish = (value) => {
    if (settled)
      return;
    settled = true;
    resolve(value);
  };
  const fail = (message) => {
    if (settled)
      return;
    settled = true;
    const notSignedIn = /not signed in|signed out|session expired|boat login/i.test(message);
    reject(new BoatError(notSignedIn ? "not-signed-in" : "command-failed", message));
  };
  const lines = readline2.createInterface({ input: stdout });
  lines.on("line", (line) => {
    const raw = parseBoatJson(line);
    if (!isRecord(raw))
      return;
    const nested = isRecord(raw.error) ? raw.error : null;
    const errorText = readString(nested?.message) ?? readString(raw.error) ?? (raw.event === "error" ? readString(raw.message) : null);
    if (errorText)
      stdoutError = errorText;
    const data = isRecord(raw.data) ? raw.data : null;
    conversationId = readString(raw.conversationId) ?? readString(data?.conversationId) ?? conversationId;
    if (conversationId)
      finish({ conversationId, pending: true });
  });
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000);
  });
  child.on("error", (error) => fail(error.message));
  child.on("close", (code) => {
    if (code === 0) {
      finish({ conversationId, pending: false });
      return;
    }
    const detail = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-2).join(" ") || stdoutError || `boat prompt exited with code ${code ?? "unknown"}.`;
    fail(detail);
  });
  setTimeout(() => finish({ conversationId, pending: true }), EARLY_RETURN_MS).unref();
});
var steerSandbox = async (sandboxId, conversationId, text) => {
  await runBoat("steer", [sandboxId, "--convo", conversationId, "--", text], { timeoutMs: MUTATION_TIMEOUT_MS2 });
};
var interruptSandbox = async (sandboxId, conversationId) => {
  await runBoat("interrupt", [sandboxId, "--convo", conversationId], { timeoutMs: MUTATION_TIMEOUT_MS2 });
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

// service/validation.ts
var SANDBOX_ID = /^[a-z]{2,8}_[a-z0-9]{4,40}$/;
var CONVERSATION_ID = /^[A-Za-z0-9_-]{1,64}$/;
var MAX_PROMPT_CHARS = 20000;
var MAX_MODEL_CHARS = 200;
var isSandboxId = (value) => typeof value === "string" && SANDBOX_ID.test(value);
var isConversationId = (value) => typeof value === "string" && CONVERSATION_ID.test(value);

// service/routes/agent.ts
var agentRoutes = (deps) => [
  route("POST", "/prompt", async (context) => {
    const body = await context.json();
    const sandboxId = readString(body?.sandbox);
    const text = readString(body?.text);
    const conversationId = readString(body?.conversation);
    const provider = readString(body?.provider);
    const model = readString(body?.model);
    if (!isSandboxId(sandboxId))
      return context.reply(400, errorBody("Unknown sandbox id."));
    if (!text)
      return context.reply(400, errorBody("Write a prompt first."));
    if (text.length > MAX_PROMPT_CHARS)
      return context.reply(400, errorBody("That prompt is too long."));
    if (provider && !isAgentProvider(provider))
      return context.reply(400, errorBody("Unknown agent provider."));
    if (conversationId && !isConversationId(conversationId)) {
      return context.reply(400, errorBody("Unknown conversation id."));
    }
    try {
      const started = await promptSandbox(sandboxId, text, {
        provider: provider ?? undefined,
        model: model && model.length <= MAX_MODEL_CHARS ? model : undefined,
        conversation: conversationId ?? undefined,
        newConversation: !conversationId
      });
      deps.conversations.forget(sandboxId);
      const answer = { ok: true, ...started };
      return context.reply(200, answer);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/steer", async (context) => {
    const body = await context.json();
    const sandboxId = readString(body?.sandbox);
    const conversationId = readString(body?.conversation);
    const text = readString(body?.text);
    if (!isSandboxId(sandboxId) || !isConversationId(conversationId)) {
      return context.reply(400, errorBody("Unknown sandbox or conversation."));
    }
    if (!text)
      return context.reply(400, errorBody("Write a message first."));
    try {
      await steerSandbox(sandboxId, conversationId, text.slice(0, MAX_PROMPT_CHARS));
      deps.conversations.forget(sandboxId);
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/interrupt", async (context) => {
    const body = await context.json();
    const sandboxId = readString(body?.sandbox);
    const conversationId = readString(body?.conversation);
    if (!isSandboxId(sandboxId) || !isConversationId(conversationId)) {
      return context.reply(400, errorBody("Unknown sandbox or conversation."));
    }
    try {
      await interruptSandbox(sandboxId, conversationId);
      deps.conversations.forget(sandboxId);
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  })
];

// service/routes/conversations.ts
var conversationRoutes = (deps) => [
  route("GET", "/conversations", async (context) => {
    const sandboxId = context.search.get("sandbox");
    if (!isSandboxId(sandboxId))
      return context.reply(400, errorBody("Unknown sandbox id."));
    try {
      const body = {
        conversations: await deps.conversations.get(sandboxId),
        now: Date.now()
      };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  })
];

// service/routes/events.ts
var HISTORY_MAX = 200;
var eventRoutes = (deps) => [
  route("GET", "/history", async (context) => {
    const sandboxId = context.search.get("sandbox");
    const conversationId = context.search.get("conversation");
    if (!isSandboxId(sandboxId) || !isConversationId(conversationId)) {
      return context.reply(400, errorBody("Unknown sandbox or conversation."));
    }
    try {
      const events = await listEvents(sandboxId, conversationId);
      const known = deps.conversations.peek(sandboxId)?.find((entry) => entry.id === conversationId);
      const body = {
        events: events.length > HISTORY_MAX ? events.slice(events.length - HISTORY_MAX) : events,
        running: known?.running ?? null,
        now: Date.now()
      };
      return context.reply(200, body);
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/watch", async (context) => {
    const body = await context.json();
    if (!body || !isSandboxId(body.sandbox) || !isConversationId(body.conversation)) {
      return context.reply(400, errorBody("Unknown sandbox or conversation."));
    }
    try {
      deps.followers.watch(body.sandbox, body.conversation);
      return context.reply(200, { ok: true });
    } catch (failure) {
      return context.reply(502, errorBody(describeFailure(failure).text));
    }
  }),
  route("POST", "/unwatch", async (context) => {
    const body = await context.json();
    if (body && isSandboxId(body.sandbox) && isConversationId(body.conversation)) {
      deps.followers.unwatch(body.sandbox, body.conversation);
    }
    const answer = { ok: true };
    return context.reply(200, answer);
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
    const snapshot = await deps.sandboxes.get();
    const scope = await deps.scoper.apply(snapshot.sandboxes, context.search.get("directory"));
    const ordered = [...scope.entries].sort((left, right) => Number(right.inProject) - Number(left.inProject));
    const body = {
      sandboxes: ordered.map((entry) => ({
        ...summaryOf(entry.sandbox),
        matchedBy: entry.matchedBy,
        inProject: entry.inProject
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
    try {
      return context.reply(200, await deps.statusView(context.search.get("directory")));
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
  emit: (topic, data) => host.emit(topic, data)
});
var route2 = createRouter([
  ...statusRoutes(context),
  ...sandboxRoutes(context),
  ...conversationRoutes(context),
  ...eventRoutes(context),
  ...agentRoutes(context),
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
  installFollowerCleanup(context.followers);
  context.refresh().catch(() => {});
});
process.on("unhandledRejection", (reason) => {
  console.error("Boat:", reason instanceof Error ? reason.message : reason);
});
