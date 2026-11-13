/**
 * The composer's pending inbox: the prompts OpenCode is holding for the open
 * session, how a row labels them, and the optimistic edits the panel makes
 * before the service confirms. Pure, so the view and the tests share it.
 */
import type { OpencodeInboxDelivery, OpencodeInboxEntry } from '../shared/opencode.ts';

/** What a row's status chip says. */
export const deliveryLabel = (delivery: OpencodeInboxDelivery): string => (
  delivery === 'steer' ? 'steer' : 'queued'
);

/** The other delivery a row switches to. */
export const toggledDelivery = (delivery: OpencodeInboxDelivery): OpencodeInboxDelivery => (
  delivery === 'steer' ? 'queue' : 'steer'
);

/** The one line a pending row shows; an entry with no text says what it is. */
export const inboxLabel = (entry: OpencodeInboxEntry): string => {
  const text = entry.text.replace(/\s+/g, ' ').trim();
  if (text) return text;
  if (entry.type === 'compaction') return 'Compact the conversation';
  if (entry.type === 'move') return 'Move the session';
  if (entry.type === 'synthetic') return 'A system prompt';
  return 'A prompt';
};

/** The attachment count a row shows after its text, or null. */
export const inboxFilesLabel = (entry: OpencodeInboxEntry): string | null => {
  if (entry.files.length === 0) return null;
  return entry.files.length === 1 ? '1 image' : `${entry.files.length} images`;
};

/** A row's full readable label, text plus what rides with it. */
export const inboxSummary = (entry: OpencodeInboxEntry): string => {
  const files = inboxFilesLabel(entry);
  return files ? `${inboxLabel(entry)} · ${files}` : inboxLabel(entry);
};

/** Drops one entry, as cancelling does. */
export const withoutInbox = (
  entries: OpencodeInboxEntry[],
  id: string,
): OpencodeInboxEntry[] => {
  const next = entries.filter((entry) => entry.id !== id);
  return next.length === entries.length ? entries : next;
};

/** Re-flags one entry, as the steer⇄queue switch does. */
export const withInboxDelivery = (
  entries: OpencodeInboxEntry[],
  id: string,
  delivery: OpencodeInboxDelivery,
): OpencodeInboxEntry[] => {
  const index = entries.findIndex((entry) => entry.id === id);
  const found = index >= 0 ? entries[index] : null;
  if (!found || found.delivery === delivery) return entries;
  const next = [...entries];
  next[index] = { ...found, delivery };
  return next;
};

/** Ids and deliveries only: what the view repaints for. */
export const inboxSignature = (entries: OpencodeInboxEntry[]): string => (
  entries.map((entry) => `${entry.id}:${entry.delivery}`).join(',')
);

/**
 * The delivery a send uses: nothing while idle (a normal prompt), steer into a
 * running turn by default, or whichever the caller asked for.
 */
export const deliveryFor = (
  turning: boolean,
  requested: OpencodeInboxDelivery | null = null,
): OpencodeInboxDelivery | null => (turning ? requested ?? 'steer' : null);
