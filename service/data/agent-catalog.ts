/**
 * The agents and models boat offers, from the public provider-models catalogue.
 * Cached for an hour, persisted as the last good copy, with a built-in fallback.
 * Availability comes from the default AI profile's connected credentials.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { isRecord, readNumber, readString } from '../../shared/json.ts';
import type { AgentDto, AgentModel } from '../../shared/routes.ts';

export const CATALOG_URL = 'https://boat.dev/api/provider-models';
export const CATALOG_TTL_MS = 60 * 60_000;
const RETRY_MS = 60_000;
const DEFAULT_FILE = join(homedir(), '.boat-openchamber', 'agents.json');

export type CatalogModel = {
  id: string;
  label: string;
  credentialIds: string[];
  reasoning: { supported: string[]; default: string | null } | null;
  fast: boolean;
};

export type CatalogAgent = {
  harness: string;
  provider: string;
  label: string;
  aliases: string[];
  order: number;
  models: CatalogModel[];
};

export type AgentCatalog = {
  fetchedAt: number;
  agents: CatalogAgent[];
};

export type AgentCatalogSource = {
  get: () => Promise<AgentCatalog>;
};

const stringList = (value: unknown): string[] => (
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
);

const parseModels = (value: unknown): CatalogModel[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((model) => {
    const id = readString(model.id);
    if (!id) return [];
    const reasoning = isRecord(model.reasoningEffort) ? model.reasoningEffort : null;
    const supported = stringList(reasoning?.supported);
    return [{
      id,
      label: readString(model.label) ?? id,
      credentialIds: stringList(model.credentialIds),
      reasoning: supported.length > 0 ? { supported, default: readString(reasoning?.default) } : null,
      fast: model.fastMode === true,
    }];
  });
};

/** Parses the catalogue as `boat prompt --help` prints it. */
export const parseAgentCatalog = (raw: unknown): CatalogAgent[] => {
  if (!isRecord(raw)) return [];

  const agents: CatalogAgent[] = [];
  for (const [harness, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) continue;
    const cli = isRecord(entry.cli) ? entry.cli : null;
    const provider = readString(cli?.name) ?? harness;
    agents.push({
      harness,
      provider,
      label: readString(cli?.description) ?? provider,
      aliases: stringList(cli?.aliases),
      order: readNumber(cli?.order) ?? 100,
      models: parseModels(entry.models),
    });
  }

  return agents.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
};

/** The seven harnesses, for when the catalogue cannot be read at all. */
export const fallbackAgents = (): CatalogAgent[] => [
  { harness: 'codex', provider: 'codex', label: 'OpenAI Codex / ChatGPT', aliases: ['codex'], order: 1, models: [] },
  { harness: 'claude-code', provider: 'claude', label: 'Claude Code', aliases: ['claude', 'claude-code'], order: 2, models: [] },
  { harness: 'pi', provider: 'pi', label: 'pi', aliases: ['pi'], order: 3, models: [] },
  { harness: 'opencode', provider: 'opencode', label: 'OpenCode', aliases: ['opencode'], order: 4, models: [] },
  { harness: 'prime-agent', provider: 'prime', label: 'Prime Agent', aliases: ['prime', 'prime-agent'], order: 5, models: [] },
  { harness: 'kimi', provider: 'kimi', label: 'Kimi Code', aliases: ['kimi', 'kimi-code'], order: 6, models: [] },
  { harness: 'mistral', provider: 'mistral', label: 'Mistral Vibe', aliases: ['mistral'], order: 7, models: [] },
];

/** `claude-code` (a conversation's harness) to `claude` (the `--provider` value). */
export const providerForHarness = (agents: CatalogAgent[], harness: string | null): string | null => {
  if (!harness) return null;
  const key = harness.trim().toLowerCase();
  if (!key) return null;
  const match = agents.find((agent) => (
    [agent.harness, agent.provider, ...agent.aliases].some((name) => name.toLowerCase() === key)
  ));
  return match?.provider ?? null;
};

/** What the panel sees: models marked available from the connected credentials. */
export const agentOptions = (
  agents: CatalogAgent[],
  connected: ReadonlySet<string> | null,
): AgentDto[] => agents.map((agent) => {
  const models: AgentModel[] = agent.models.map((model) => ({
    id: model.id,
    label: model.label,
    available: connected === null
      || model.credentialIds.length === 0
      || model.credentialIds.some((credential) => connected.has(credential)),
    reasoning: model.reasoning,
    fast: model.fast,
  }));

  return {
    provider: agent.provider,
    label: agent.label,
    order: agent.order,
    // A fallback agent has no model list; keep it usable rather than hide it.
    available: models.length === 0 ? true : models.some((model) => model.available),
    models,
  };
});

const parseStored = (raw: unknown): CatalogAgent[] | null => {
  if (!isRecord(raw) || !Array.isArray(raw.agents)) return null;
  const agents = raw.agents.filter(isRecord).flatMap((entry) => {
    const harness = readString(entry.harness);
    const provider = readString(entry.provider);
    if (!harness || !provider) return [];
    const models = Array.isArray(entry.models) ? entry.models.filter(isRecord).flatMap((model) => {
      const id = readString(model.id);
      if (!id) return [];
      const reasoning = isRecord(model.reasoning) ? model.reasoning : null;
      const supported = stringList(reasoning?.supported);
      return [{
        id,
        label: readString(model.label) ?? id,
        credentialIds: stringList(model.credentialIds),
        reasoning: supported.length > 0 ? { supported, default: readString(reasoning?.default) } : null,
        fast: model.fast === true,
      }];
    }) : [];
    return [{
      harness,
      provider,
      label: readString(entry.label) ?? provider,
      aliases: stringList(entry.aliases),
      order: readNumber(entry.order) ?? 100,
      models,
    }];
  });
  return agents.length > 0 ? agents : null;
};

const readStored = (file: string): CatalogAgent[] | null => {
  try {
    return parseStored(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
};

const writeStored = (file: string, catalog: AgentCatalog): void => {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(catalog));
  } catch {
    // The next start fetches again.
  }
};

export const createAgentCatalog = (options: {
  url?: string;
  file?: string;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
} = {}): AgentCatalogSource => {
  const url = options.url ?? CATALOG_URL;
  const file = options.file ?? DEFAULT_FILE;
  const ttlMs = options.ttlMs ?? CATALOG_TTL_MS;
  const clock = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;

  let current: AgentCatalog | null = null;
  let loading: Promise<AgentCatalog> | null = null;
  let retryAt = 0;

  const load = async (): Promise<AgentCatalog> => {
    const fetchedAt = clock();
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`The catalogue answered HTTP ${response.status}.`);
      const agents = parseAgentCatalog(await response.json());
      if (agents.length === 0) throw new Error('The catalogue was empty.');
      current = { fetchedAt, agents };
      writeStored(file, current);
      return current;
    } catch {
      if (!current) {
        current = { fetchedAt: 0, agents: readStored(file) ?? fallbackAgents() };
      }
      retryAt = clock() + RETRY_MS;
      return current;
    }
  };

  return {
    get: async () => {
      if (current && clock() - current.fetchedAt < ttlMs) return current;
      if (current && clock() < retryAt) return current;
      if (loading) return loading;
      loading = load().finally(() => {
        loading = null;
      });
      return loading;
    },
  };
};
