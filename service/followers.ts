/**
 * One `boat events <id> --convo <c> --follow --json` process per conversation
 * the panel watches. Events are normalised, batched and forwarded; nothing is
 * kept for a panel that is not looking.
 */
import type { ChildProcess } from 'node:child_process';
import readline from 'node:readline';

import { eventSize, normalizeEvent } from './domain/events.ts';
import { BoatError, parseBoatJson, spawnBoat } from './boat.ts';
import type { UiEvent } from '../shared/types.ts';

export type EventSink = (topic: string, data: unknown) => Promise<unknown>;

export type Followers = {
  watch: (sandboxId: string, conversationId: string) => void;
  unwatch: (sandboxId: string, conversationId: string) => void;
  stopAll: () => void;
};

type Follower = {
  key: string;
  sandboxId: string;
  conversationId: string;
  child: ChildProcess;
  lastPing: number;
  buffer: UiEvent[];
  flushTimer: NodeJS.Timeout | null;
  stderr: string;
  stopped: boolean;
};

const MAX_BATCH_EVENTS = 40;
/** The host refuses an emit whose data passes 64 000 characters. */
const MAX_BATCH_CHARS = 36_000;

const keyOf = (sandboxId: string, conversationId: string): string => `${sandboxId}:${conversationId}`;

/** Starts one follower per conversation, pings keep it alive, silence kills it. */
export const createFollowers = (options: {
  sink: EventSink;
  ttlMs: number;
  sweepMs: number;
  flushMs: number;
}): Followers => {
  const followers = new Map<string, Follower>();
  let sweeper: NodeJS.Timeout | null = null;

  const send = (topic: string, data: unknown): void => {
    try {
      void Promise.resolve(options.sink(topic, data)).catch(() => {});
    } catch {
      // A panel that is gone takes no events; history is read again on open.
    }
  };

  const flush = (follower: Follower): void => {
    if (follower.flushTimer) {
      clearTimeout(follower.flushTimer);
      follower.flushTimer = null;
    }
    if (follower.buffer.length === 0) return;

    const batch: UiEvent[] = [];
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
      send('boat:events', {
        sandbox: follower.sandboxId,
        conversation: follower.conversationId,
        events: batch,
      });
    }
    if (follower.buffer.length > 0 && !follower.stopped) {
      follower.flushTimer = setTimeout(() => flush(follower), options.flushMs);
    }
  };

  const queue = (follower: Follower, event: UiEvent): void => {
    follower.buffer.push(event);
    if (follower.buffer.length >= MAX_BATCH_EVENTS) {
      flush(follower);
      return;
    }
    if (!follower.flushTimer) follower.flushTimer = setTimeout(() => flush(follower), options.flushMs);
  };

  const dispose = (follower: Follower): void => {
    follower.stopped = true;
    if (follower.flushTimer) {
      clearTimeout(follower.flushTimer);
      follower.flushTimer = null;
    }
    followers.delete(follower.key);
    const child = follower.child;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 2_000).unref();
    }
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

  return {
    watch: (sandboxId, conversationId) => {
      const key = keyOf(sandboxId, conversationId);
      const existing = followers.get(key);
      if (existing) {
        existing.lastPing = Date.now();
        return;
      }

      const child = spawnBoat('events', [sandboxId, '--convo', conversationId, '--follow']);
      const stdout = child.stdout;
      if (!stdout) {
        child.kill('SIGTERM');
        throw new BoatError('command-failed', 'boat events did not open its output.');
      }

      const follower: Follower = {
        key,
        sandboxId,
        conversationId,
        child,
        lastPing: Date.now(),
        buffer: [],
        flushTimer: null,
        stderr: '',
        stopped: false,
      };
      followers.set(key, follower);
      ensureSweeper();

      const lines = readline.createInterface({ input: stdout });
      lines.on('line', (line) => {
        const event = normalizeEvent(parseBoatJson(line), conversationId);
        if (event) queue(follower, event);
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        follower.stderr = `${follower.stderr}${String(chunk)}`.slice(-1_000);
      });

      child.on('spawn', () => {
        send('boat:stream', { sandbox: sandboxId, conversation: conversationId, state: 'live' });
      });

      child.on('error', (error) => {
        send('boat:stream', {
          sandbox: sandboxId,
          conversation: conversationId,
          state: 'error',
          message: error.message,
        });
        dispose(follower);
      });

      child.on('close', (code) => {
        if (follower.stopped) {
          followers.delete(key);
          return;
        }
        flush(follower);
        const detail = follower.stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-1)[0] ?? null;
        send('boat:stream', {
          sandbox: sandboxId,
          conversation: conversationId,
          state: 'ended',
          message: detail ?? (code === 0 ? null : `boat events exited with code ${code ?? 'unknown'}.`),
        });
        follower.stopped = true;
        if (follower.flushTimer) clearTimeout(follower.flushTimer);
        followers.delete(key);
      });
    },

    unwatch: (sandboxId, conversationId) => {
      const follower = followers.get(keyOf(sandboxId, conversationId));
      if (follower) dispose(follower);
    },

    stopAll: () => {
      for (const follower of [...followers.values()]) dispose(follower);
    },
  };
};

/** Kills every follower when the service itself is going away. */
export const installFollowerCleanup = (
  followers: Followers,
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
