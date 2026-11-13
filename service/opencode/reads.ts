/**
 * Read helpers around one sandbox's OpenCode client. Routes and the live smoke
 * script share them; every raw response is normalised here, never in a route.
 */
import { isRecord, readString } from '../../shared/json.ts';
import type {
  OpencodeAgent,
  OpencodeMessage,
  OpencodeModel,
  OpencodePermissionRequest,
  OpencodeProvider,
  OpencodeQuestionRequest,
  OpencodeSession,
  OpencodeModelRef,
} from '../../shared/opencode.ts';
import type { OpencodeConnection } from './connection.ts';
import {
  normalizeAgent,
  normalizeMessage,
  normalizeModels,
  normalizePermissionRequest,
  normalizeProvider,
  normalizeQuestionRequest,
  normalizeSession,
  readModelRef,
} from './normalize.ts';

const SESSION_PAGE = 100;
const SESSION_PAGES_MAX = 4;
const MESSAGE_PAGE = 200;
const MAX_MESSAGE_PAGES = 10;

const rowsOf = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  return isRecord(value) && Array.isArray(value.data) ? value.data : [];
};

const sessionsOf = (rows: unknown[]): OpencodeSession[] => rows.flatMap((entry) => {
  const session = normalizeSession(entry);
  return session ? [session] : [];
});

const cursorOf = (raw: unknown): string | null => (
  readString(isRecord(raw) && isRecord(raw.cursor) ? raw.cursor.next : null)
);

/**
 * Sessions in a sandbox, newest first. OpenCode's `directory` filter is only a
 * project hint (it returns sessions that live above the picked directory), so
 * the exact match is made here: a directory's sessions are the ones whose own
 * location equals it. Paging stops once there are enough matches.
 */
export const readSessions = async (
  connection: OpencodeConnection,
  directory: string | null = null,
): Promise<OpencodeSession[]> => {
  const rows: unknown[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < (directory ? SESSION_PAGES_MAX : 1); page += 1) {
    const raw: unknown = await connection.client.session.list({
      limit: SESSION_PAGE,
      // A cursor already carries the order the first page chose.
      ...(cursor ? { cursor } : { order: 'desc' as const }),
    });
    const batch = rowsOf(raw);
    rows.push(...batch);

    if (!directory) break;
    if (sessionsOf(rows).filter((session) => session.directory === directory).length >= SESSION_PAGE) break;
    cursor = cursorOf(raw);
    if (!cursor || batch.length === 0) break;
  }

  const sessions = sessionsOf(rows);
  if (!directory) return sessions;
  return sessions.filter((session) => session.directory === directory).slice(0, SESSION_PAGE);
};

export const readSession = async (
  connection: OpencodeConnection,
  sessionID: string,
): Promise<OpencodeSession | null> => {
  const raw: unknown = await connection.client.session.get({ sessionID });
  return normalizeSession(raw);
};

/**
 * Reads the whole projected history in cursor pages. Newest limits keep a
 * runaway session from making every panel open read tens of thousands of rows.
 */
export const readSessionMessages = async (
  connection: OpencodeConnection,
  sessionID: string,
): Promise<{ messages: OpencodeMessage[]; truncated: boolean }> => {
  const rows: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < MAX_MESSAGE_PAGES; page += 1) {
    const raw: unknown = await connection.client.message.list({
      sessionID,
      limit: MESSAGE_PAGE,
      // OpenCode rejects `order` together with a cursor; the cursor keeps the
      // order the first page chose.
      ...(cursor ? { cursor } : { order: 'asc' as const }),
    });
    for (const row of rowsOf(raw)) {
      const id = isRecord(row) ? readString(row.id) : null;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
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
        truncated: false,
      };
    }
  }

  return {
    messages: rows.flatMap((row) => {
      const message = normalizeMessage(row, sessionID);
      return message ? [message] : [];
    }),
    truncated: true,
  };
};

export const readPermissions = async (
  connection: OpencodeConnection,
  sessionID: string,
): Promise<OpencodePermissionRequest[]> => {
  const raw: unknown = await connection.client.permission.list({ sessionID });
  return rowsOf(raw).flatMap((entry) => {
    const request = normalizePermissionRequest(entry);
    return request ? [request] : [];
  });
};

export const readQuestions = async (
  connection: OpencodeConnection,
  sessionID: string,
): Promise<OpencodeQuestionRequest[]> => {
  const raw: unknown = await connection.client.session.form.list({ sessionID });
  return rowsOf(raw).flatMap((entry) => {
    const request = normalizeQuestionRequest(entry);
    return request ? [request] : [];
  });
};

export type OpencodeCatalogRead = {
  agents: OpencodeAgent[];
  providers: OpencodeProvider[];
  models: OpencodeModel[];
  defaultAgent: string | null;
  defaultModel: OpencodeModelRef | null;
};

export const readCatalog = async (connection: OpencodeConnection): Promise<OpencodeCatalogRead> => {
  const [agentsRaw, providersRaw, modelsRaw, defaultRaw] = await Promise.all([
    connection.client.agent.list() as unknown,
    connection.client.provider.list() as unknown,
    connection.client.model.list() as unknown,
    connection.client.model.default() as unknown,
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
    defaultAgent: agents.find((agent) => agent.mode === 'primary' && !agent.hidden)?.id ?? null,
    defaultModel: readModelRef(defaultData),
  };
};
