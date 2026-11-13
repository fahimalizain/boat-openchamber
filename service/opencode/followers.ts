/**
 * One OpenCode SSE subscription per sandbox the panel watches. Events are
 * normalised, batched and forwarded on `boat:opencode`; nothing is kept for a
 * panel that is not looking. The follower's TTL is refreshed by the panel's
 * `/opencode/watch` calls, and a silent watcher is swept away.
 */
import type { OpencodeEventsPayload, OpencodeStreamEvent, OpencodeStreamState } from '../../shared/opencode.ts';
import { OPENCODE_EVENTS_TOPIC, OPENCODE_STREAM_TOPIC } from '../../shared/opencode.ts';
import {
  describeOpencodeError,
  isReconnectableFailure,
  type OpencodeConnection,
  type OpencodeConnections,
} from './connection.ts';
import { normalizeStreamEvent } from './normalize.ts';

export type OpencodeEventSink = (topic: string, data: unknown) => Promise<unknown>;

export type OpencodeFollowers = {
  watch: (sandboxId: string) => void;
  unwatch: (sandboxId: string) => void;
  stopAll: () => void;
};

type Follower = {
  sandboxId: string;
  lastPing: number;
  controller: AbortController | null;
  buffer: OpencodeStreamEvent[];
  flushTimer: NodeJS.Timeout | null;
  stopped: boolean;
  live: boolean;
};

const MAX_BATCH_EVENTS = 40;
/** The host refuses an emit whose data passes 64 000 characters. */
const MAX_BATCH_CHARS = 36_000;

const eventSize = (event: OpencodeStreamEvent): number => {
  try {
    return JSON.stringify(event).length;
  } catch {
    return 1_000;
  }
};

export const createOpencodeFollowers = (options: {
  connections: OpencodeConnections;
  sink: OpencodeEventSink;
  ttlMs: number;
  sweepMs: number;
  flushMs: number;
}): OpencodeFollowers => {
  const followers = new Map<string, Follower>();
  let sweeper: NodeJS.Timeout | null = null;

  const send = (topic: string, data: unknown): void => {
    try {
      void Promise.resolve(options.sink(topic, data)).catch(() => {});
    } catch {
      // A panel that is gone takes no events; it reads history again on open.
    }
  };

  const sendState = (follower: Follower, state: OpencodeStreamState['state'], message: string | null): void => {
    const payload: OpencodeStreamState = { sandbox: follower.sandboxId, state, message };
    send(OPENCODE_STREAM_TOPIC, payload);
  };

  const flush = (follower: Follower): void => {
    if (follower.flushTimer) {
      clearTimeout(follower.flushTimer);
      follower.flushTimer = null;
    }
    if (follower.buffer.length === 0) return;

    const batch: OpencodeStreamEvent[] = [];
    let chars = 0;
    while (follower.buffer.length > 0 && batch.length < MAX_BATCH_EVENTS) {
      const next = follower.buffer[0];
      if (!next) break;
      const size = eventSize(next);
      if (batch.length > 0 && chars + size > MAX_BATCH_CHARS) break;
      follower.buffer.shift();
      batch.push(next);
      chars += size;
    }

    if (batch.length > 0) {
      const payload: OpencodeEventsPayload = { sandbox: follower.sandboxId, events: batch };
      send(OPENCODE_EVENTS_TOPIC, payload);
    }
    if (follower.buffer.length > 0 && !follower.stopped) {
      follower.flushTimer = setTimeout(() => flush(follower), options.flushMs);
    }
  };

  const queue = (follower: Follower, event: OpencodeStreamEvent): void => {
    follower.buffer.push(event);
    if (follower.buffer.length >= MAX_BATCH_EVENTS) {
      flush(follower);
      return;
    }
    if (!follower.flushTimer) follower.flushTimer = setTimeout(() => flush(follower), options.flushMs);
  };

  const dispose = (follower: Follower): void => {
    follower.stopped = true;
    follower.controller?.abort();
    follower.controller = null;
    if (follower.flushTimer) {
      clearTimeout(follower.flushTimer);
      follower.flushTimer = null;
    }
    followers.delete(follower.sandboxId);
  };

  const ensureSweeper = (): void => {
    if (sweeper) return;
    sweeper = setInterval(() => {
      const now = Date.now();
      for (const follower of [...followers.values()]) {
        if (now - follower.lastPing > options.ttlMs) dispose(follower);
      }
      if (followers.size === 0 && sweeper) {
        clearInterval(sweeper);
        sweeper = null;
      }
    }, options.sweepMs);
    sweeper.unref();
  };

  const open = async (follower: Follower): Promise<void> => {
    let retried = false;

    while (!follower.stopped) {
      let connection: OpencodeConnection;
      try {
        connection = await options.connections.get(follower.sandboxId);
      } catch (failure) {
        sendState(follower, 'error', describeOpencodeError(failure).message);
        dispose(follower);
        return;
      }

      const controller = new AbortController();
      follower.controller = controller;
      let seen = false;

      try {
        for await (const raw of connection.client.event.subscribe({ signal: controller.signal })) {
          if (follower.stopped) return;
          seen = true;
          if (!follower.live) {
            follower.live = true;
            sendState(follower, 'live', null);
          }
          const event = normalizeStreamEvent(raw);
          if (event) queue(follower, event);
        }
        if (follower.stopped) return;
        flush(follower);
        sendState(follower, 'ended', null);
        dispose(follower);
        return;
      } catch (failure) {
        if (follower.stopped) return;
        if (!seen && !retried && isReconnectableFailure(failure)) {
          retried = true;
          options.connections.invalidate(follower.sandboxId);
          continue;
        }
        flush(follower);
        sendState(follower, 'error', describeOpencodeError(failure).message);
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
      const follower: Follower = {
        sandboxId,
        lastPing: Date.now(),
        controller: null,
        buffer: [],
        flushTimer: null,
        stopped: false,
        live: false,
      };
      followers.set(sandboxId, follower);
      ensureSweeper();
      void open(follower).catch((failure: unknown) => {
        sendState(follower, 'error', describeOpencodeError(failure).message);
        dispose(follower);
      });
    },

    unwatch: (sandboxId) => {
      const follower = followers.get(sandboxId);
      if (follower) dispose(follower);
    },

    stopAll: () => {
      for (const follower of [...followers.values()]) dispose(follower);
    },
  };
};

/** Kills every relay when the service itself is going away. */
export const installFollowerCleanup = (
  followers: OpencodeFollowers,
  others: Array<{ stopAll: () => void }> = [],
): void => {
  const stopAll = (): void => {
    followers.stopAll();
    for (const other of others) other.stopAll();
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      stopAll();
      process.exit(0);
    });
  }
  process.on('exit', stopAll);
};
