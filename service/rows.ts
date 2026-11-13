/**
 * Turns sandboxes into the app-drawn Work Status rows, and into the terse
 * instruction text every agent gets.
 *
 * Row, control and value limits come from the SDK: ids match
 * `^[a-z][a-z0-9-]{0,39}$`, so a sandbox id (`bx_7ppmwt9v`) is carried with its
 * underscore swapped for a dash and decoded back in the router.
 */
import type {
  GuestStatusAction,
  GuestStatusChip,
  GuestStatusRow,
  GuestStatusTone,
  GuestStatusView,
} from '@openchamber/sdk';

import type { Sandbox } from './boat.ts';

const ROWS_MAX = 16;
const ROW_ID_MAX = 40;
const LABEL_MAX = 60;
const VALUE_MAX = 80;
const NOTE_MAX = 300;
const TOOLTIP_MAX = 200;

type LineRow = Extract<GuestStatusRow, { kind: 'line' }>;

const UP_STATES = new Set(['ready', 'idle', 'running']);
const BOOTING_STATES = new Set(['provisioned', 'cloning']);
const PENDING_STATES = new Set(['provisioned', 'cloning', 'stopping']);

/** The sandbox is up and can take commands: Stop, Extend and Desktop apply. */
export const isUp = (state: string): boolean => UP_STATES.has(state);

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

export type ActionVerb = 'stop' | 'extend' | 'resume';

/** The action id a click posts back, e.g. `stop-bx-7ppmwt9v`. */
export const actionId = (verb: ActionVerb, sandboxId: string): string => (
  clip(`${verb}-${sandboxId.replace(/_/g, '-').toLowerCase()}`, ROW_ID_MAX)
);

/** The sandbox a posted action id names, or null when it is not one of ours. */
export const decodeActionId = (id: string): { verb: ActionVerb; sandboxId: string } | null => {
  const match = /^(stop|extend|resume)-([a-z0-9-]{1,32})$/.exec(id);
  if (!match?.[1] || !match[2]) return null;
  const verb = match[1] as ActionVerb;
  return { verb, sandboxId: match[2].replace('-', '_') };
};

const formatDuration = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

const sizeOf = (sandbox: Sandbox): string | null => {
  const parts = [sandbox.type, sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`].filter(Boolean);
  return parts.length === 0 ? null : parts.join(' ');
};

const timeLeft = (sandbox: Sandbox, now: number): string | null => {
  if (!isUp(sandbox.state)) return null;
  if (!sandbox.archiveAfter) return sandbox.ttlSeconds === null ? 'no auto-stop' : null;
  const deadline = Date.parse(sandbox.archiveAfter);
  if (!Number.isFinite(deadline)) return null;
  const remaining = deadline - now;
  return remaining <= 0 ? 'auto-stop due' : `${formatDuration(remaining)} left`;
};

const valueOf = (sandbox: Sandbox, now: number): string => {
  const parts = [sandbox.state, sizeOf(sandbox), timeLeft(sandbox, now)].filter(Boolean);
  return clip(parts.join(' · '), VALUE_MAX);
};

const dotOf = (state: string): GuestStatusTone => {
  if (UP_STATES.has(state)) return 'success';
  if (PENDING_STATES.has(state)) return 'warning';
  if (state === 'stopped') return 'muted';
  if (state === 'error') return 'error';
  return 'muted';
};

const tooltipOf = (sandbox: Sandbox, now: number): string => {
  const parts = [
    sandbox.id,
    sandbox.environment ? `env ${sandbox.environment}` : null,
    sandbox.vcpu === null ? null : `${sandbox.vcpu} vCPU`,
    sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`,
    sandbox.sshEndpoint ? `ssh ${sandbox.sshEndpoint}` : null,
    sandbox.archiveAfter
      ? `auto-stops ${new Date(Date.parse(sandbox.archiveAfter)).toLocaleString()} (in ${formatDuration(Date.parse(sandbox.archiveAfter) - now)})`
      : null,
  ].filter(Boolean);
  return clip(parts.join(' · '), TOOLTIP_MAX);
};

const actionsOf = (sandbox: Sandbox): GuestStatusAction[] => {
  if (!isUp(sandbox.state)) {
    if (sandbox.state === 'stopped') {
      return [{ kind: 'button', id: actionId('resume', sandbox.id), label: 'Resume' }];
    }
    if (BOOTING_STATES.has(sandbox.state)) {
      return [{
        kind: 'button',
        id: actionId('stop', sandbox.id),
        label: 'Cancel',
        variant: 'destructive',
        confirm: 'Stop this sandbox while it is still starting?',
      }];
    }
    return [];
  }
  const extend: GuestStatusAction = {
    kind: 'button',
    id: actionId('extend', sandbox.id),
    label: 'Extend 1h',
    variant: 'outline',
    disabled: !sandbox.archiveAfter && sandbox.ttlSeconds === null,
  };
  return [
    { kind: 'button', id: actionId('stop', sandbox.id), label: 'Stop', variant: 'destructive', confirm: 'Stop this sandbox?' },
    extend,
  ];
};

const desktopChip = (sandbox: Sandbox, desktopUrls: Map<string, string | null>): GuestStatusChip | null => {
  const url = desktopUrls.get(sandbox.id);
  if (!url || !isUp(sandbox.state)) return null;
  return { id: clip(`desk-${sandbox.id.replace(/_/g, '-').toLowerCase()}`, ROW_ID_MAX), label: 'Desktop', url };
};

export type ViewInput = {
  sandboxes: Sandbox[];
  desktopUrls: Map<string, string | null>;
  agents: Set<string>;
  /** A message to show instead of rows when the CLI failed. */
  error: { text: string; tone: 'warning' | 'error' } | null;
  /** A plan or limit note, when one is worth showing. */
  planNote: string | null;
  now: number;
};

const orderOf = (sandbox: Sandbox): number => {
  if (UP_STATES.has(sandbox.state)) return 0;
  if (PENDING_STATES.has(sandbox.state)) return 1;
  if (sandbox.state === 'stopped') return 2;
  return 3;
};

export const buildView = (input: ViewInput): GuestStatusView => {
  const notes: GuestStatusRow[] = [];

  if (input.error) {
    notes.push({
      kind: 'note',
      id: 'note-error',
      text: clip(input.error.text, NOTE_MAX),
      tone: input.error.tone,
    });
  }

  if (!input.error && input.sandboxes.length === 0) {
    notes.push({
      kind: 'note',
      id: 'note-empty',
      text: 'No sandboxes. Create one with `boat new`, then reopen this section.',
      tone: 'info',
    });
  }

  if (input.planNote) {
    notes.push({ kind: 'note', id: 'note-plan', text: clip(input.planNote, NOTE_MAX), tone: 'warning' });
  }

  const lines: LineRow[] = input.sandboxes
    .slice()
    .sort((left, right) => {
      const live = Number(input.agents.has(right.id)) - Number(input.agents.has(left.id));
      if (live !== 0) return live;
      const order = orderOf(left) - orderOf(right);
      if (order !== 0) return order;
      return (Date.parse(right.createdAt ?? '') || 0) - (Date.parse(left.createdAt ?? '') || 0);
    })
    .map((sandbox): LineRow => {
      const row: LineRow = {
        kind: 'line',
        id: clip(`sb-${sandbox.id.replace(/_/g, '-').toLowerCase()}`, ROW_ID_MAX),
        label: clip(sandbox.name || sandbox.id, LABEL_MAX),
        dot: dotOf(sandbox.state),
        value: valueOf(sandbox, input.now),
        tooltip: tooltipOf(sandbox, input.now),
        actions: actionsOf(sandbox),
      };
      if (input.agents.has(sandbox.id)) row.badge = { label: 'agent running', tone: 'accent' };
      const chip = desktopChip(sandbox, input.desktopUrls);
      if (chip) row.content = { kind: 'chips', chips: [chip] };
      return row;
    });

  const room = Math.max(0, ROWS_MAX - notes.length);
  return { rows: [...lines.slice(0, room), ...notes] };
};

export const buildInstructions = (sandboxes: Sandbox[], now: number, error: string | null = null): string => {
  if (error && sandboxes.length === 0) {
    return clip(`Boat cloud sandboxes are unavailable. ${error}`, 1_000);
  }

  const lines: string[] = [
    'Boat sandboxes (boat.dev) managed by the Boat extension, reachable with the `boat` CLI:',
  ];

  const shown = sandboxes.slice(0, 12);
  if (shown.length === 0) {
    lines.push('- none right now. Create one with `boat new`.');
  } else {
    for (const sandbox of shown) {
      const details = [sandbox.state, sizeOf(sandbox), timeLeft(sandbox, now)].filter(Boolean).join(', ');
      lines.push(`- ${sandbox.id} "${sandbox.name}": ${details}`);
    }
    if (sandboxes.length > shown.length) lines.push(`- and ${sandboxes.length - shown.length} more (see \`boat list\`).`);
  }

  lines.push(
    'Run commands with `boat exec <id> -- <command>`. Ask a sandbox agent with `boat prompt <id> --provider <claude|codex|opencode|pi|kimi|mistral|prime> --model <model> [--new | --resume <conversation>] "<text>"`; add to a running turn with `boat steer <id> --convo <conversation> "<text>"`, stop it with `boat interrupt <id>`. Pass `--json --no-update` to every command.',
  );

  return clip(lines.join('\n'), 4_000);
};
