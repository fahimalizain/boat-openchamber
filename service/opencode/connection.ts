/**
 * One OpenCode HTTP connection per sandbox: start the sandbox's server, host
 * its port through boat, read the password, and keep the resulting client.
 * Credentials live only inside the client; nothing here is ever returned to the
 * panel or written to a log. A 401, a 403 from boat's port proxy, or a transport
 * failure rebuilds the connection once and retries.
 */
import { OpenCode } from '@opencode/client';

import { isRecord, readString } from '../../shared/json.ts';
import { BoatError } from '../boat.ts';
import { ensureOpencodeService, hostOpencode, type OpencodeService } from '../domain/opencode.ts';

export type OpencodeClient = ReturnType<typeof OpenCode.make>;

/** Everything a route may see: no headers, no password, no token. */
export type OpencodeConnection = {
  sandboxId: string;
  client: OpencodeClient;
  home: string;
  /** Where a new session goes by default. */
  directory: string;
  /** Repository directories then home, as offered by the catalog. */
  directories: string[];
};

export type OpencodeConnections = {
  get: (sandboxId: string, options?: { force?: boolean }) => Promise<OpencodeConnection>;
  run: <T>(sandboxId: string, operation: (connection: OpencodeConnection) => Promise<T>) => Promise<T>;
  invalidate: (sandboxId: string) => void;
  forget: (sandboxId: string) => void;
};

/** Re-check credentials and addresses at most this often on a quiet service. */
const DEFAULT_TTL_MS = 30 * 60_000;

const build = async (sandboxId: string): Promise<OpencodeConnection> => {
  const service: OpencodeService = await ensureOpencodeService(sandboxId);
  const hosted = await hostOpencode(sandboxId, service.port);
  if (hosted.protected && !hosted.token) {
    throw new Error('boat returned no access token for the OpenCode port.');
  }

  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`opencode:${service.password}`, 'utf8').toString('base64')}`,
  };
  if (hosted.token) headers.Cookie = `_port_auth=${hosted.token}`;

  return {
    sandboxId,
    client: OpenCode.make({ baseUrl: hosted.origin, headers }),
    home: service.home,
    directory: service.directory,
    directories: service.directories,
  };
};

const messageOf = (failure: unknown): string | null => {
  if (failure instanceof Error && failure.message.trim()) return failure.message;
  if (!isRecord(failure)) return null;
  const direct = readString(failure.message);
  if (direct) return direct;
  const data = isRecord(failure.data) ? failure.data : null;
  return readString(data?.message);
};

/** True when rebuilding the connection could fix this failure. */
export const isReconnectableFailure = (failure: unknown): boolean => {
  if (isRecord(failure) && readString(failure._tag) === 'UnauthorizedError') return true;
  if (failure instanceof Error && failure.name === 'ClientError') {
    const reason = (failure as unknown as { reason?: unknown }).reason;
    if (reason === 'Transport') return true;
    // boat's port proxy answers 403 without OpenCode's JSON body, so the client
    // reports an unexpected status with the code in its message.
    return reason === 'UnexpectedStatus' && /\b40[13]\b/.test(failure.message);
  }
  return false;
};

const CLIENT_FAILURE: Record<string, string> = {
  Transport: 'The OpenCode server in that sandbox did not answer.',
  UnexpectedStatus: 'The OpenCode server refused the request.',
  UnsupportedContentType: 'OpenCode returned an unexpected answer.',
  MalformedResponse: 'OpenCode returned an unexpected answer.',
  SseEventTooLarge: 'OpenCode sent an event that was too large to read.',
};

const DECLARED_FAILURE: Record<string, string> = {
  UnauthorizedError: "OpenCode refused this service's credentials.",
  SessionNotFoundError: 'That OpenCode session no longer exists.',
  LocationNotFoundError: 'OpenCode does not know that directory.',
  SessionBusyError: 'That OpenCode session is busy; wait for it to finish.',
  PermissionNotFoundError: 'That permission request is no longer waiting.',
  FormNotFoundError: 'That question is no longer waiting.',
  FormAlreadySettledError: 'That question was already answered.',
};

/** Turns a client or declared OpenCode error into one short panel message. */
export const describeOpencodeError = (failure: unknown): Error => {
  if (failure instanceof BoatError) return failure;

  if (failure instanceof Error && failure.name === 'ClientError') {
    const reason = (failure as unknown as { reason?: unknown }).reason;
    const text = typeof reason === 'string' ? CLIENT_FAILURE[reason] : null;
    if (text) return new Error(text);
  }

  const tag = isRecord(failure) ? readString(failure._tag) : null;
  if (tag) {
    const text = DECLARED_FAILURE[tag] ?? (tag === 'FormInvalidAnswerError' ? messageOf(failure) : null);
    if (text) return new Error(text);
  }

  const message = messageOf(failure);
  return new Error(message ?? 'OpenCode did not answer.');
};

export const createOpencodeConnections = (options: { ttlMs?: number } = {}): OpencodeConnections => {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const entries = new Map<string, { at: number; connection: OpencodeConnection }>();
  const pending = new Map<string, Promise<OpencodeConnection>>();
  /** Bumped on invalidate so a slow build cannot repopulate a stale entry. */
  const epochs = new Map<string, number>();

  const invalidate = (sandboxId: string): void => {
    entries.delete(sandboxId);
    epochs.set(sandboxId, (epochs.get(sandboxId) ?? 0) + 1);
  };

  const get = async (sandboxId: string, readOptions: { force?: boolean } = {}): Promise<OpencodeConnection> => {
    const cached = entries.get(sandboxId);
    if (!readOptions.force && cached && Date.now() - cached.at < ttlMs) return cached.connection;

    const running = pending.get(sandboxId);
    if (running) return running;

    const epoch = epochs.get(sandboxId) ?? 0;
    const promise = build(sandboxId).then((connection) => {
      if ((epochs.get(sandboxId) ?? 0) === epoch) entries.set(sandboxId, { at: Date.now(), connection });
      return connection;
    }).finally(() => {
      if (pending.get(sandboxId) === promise) pending.delete(sandboxId);
    });
    pending.set(sandboxId, promise);
    return promise;
  };

  return {
    get,
    invalidate,
    forget: invalidate,
    run: async (sandboxId, operation) => {
      let connection = await get(sandboxId);
      try {
        return await operation(connection);
      } catch (failure) {
        if (!isReconnectableFailure(failure)) throw describeOpencodeError(failure);
        invalidate(sandboxId);
        connection = await get(sandboxId, { force: true });
        try {
          return await operation(connection);
        } catch (second) {
          throw describeOpencodeError(second);
        }
      }
    },
  };
};
