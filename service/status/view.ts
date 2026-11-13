/**
 * Sandbox rows for the Work Status section. Ids follow the host's rule, so a
 * sandbox id (`bx_7ppmwt9v`) travels with its underscore swapped for a dash.
 */
import type {
  GuestStatusAction,
  GuestStatusChip,
  GuestStatusRow,
  GuestStatusTone,
  GuestStatusView,
} from '@openchamber/sdk';

import { statusActionId } from '../../shared/routes.ts';
import {
  isBootingState,
  isPendingState,
  isStoppedState,
  isUpState,
  type Sandbox,
} from '../../shared/types.ts';
import type { Failure } from '../failures.ts';

const ROWS_MAX = 16;
const ROW_ID_MAX = 40;
const LABEL_MAX = 60;
const VALUE_MAX = 80;
const NOTE_MAX = 300;
const TOOLTIP_MAX = 200;

type LineRow = Extract<GuestStatusRow, { kind: 'line' }>;

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

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
  if (!isUpState(sandbox.state)) return null;
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
  if (isUpState(state)) return 'success';
  if (isPendingState(state)) return 'warning';
  if (isStoppedState(state)) return 'muted';
  if (state === 'error') return 'error';
  return 'muted';
};

const tooltipOf = (sandbox: Sandbox, now: number): string => {
  const deadline = sandbox.archiveAfter ? Date.parse(sandbox.archiveAfter) : Number.NaN;
  const parts = [
    sandbox.id,
    sandbox.environment ? `env ${sandbox.environment}` : null,
    sandbox.vcpu === null ? null : `${sandbox.vcpu} vCPU`,
    sandbox.memoryGB === null ? null : `${sandbox.memoryGB} GB`,
    sandbox.sshEndpoint ? `ssh ${sandbox.sshEndpoint}` : null,
    Number.isFinite(deadline)
      ? `auto-stops ${new Date(deadline).toLocaleString()} (in ${formatDuration(deadline - now)})`
      : null,
  ].filter(Boolean);
  return clip(parts.join(' · '), TOOLTIP_MAX);
};

const actionsOf = (sandbox: Sandbox): GuestStatusAction[] => {
  if (!isUpState(sandbox.state)) {
    if (isStoppedState(sandbox.state)) {
      return [{ kind: 'button', id: statusActionId('resume', sandbox.id), label: 'Resume' }];
    }
    if (isBootingState(sandbox.state)) {
      return [{
        kind: 'button',
        id: statusActionId('stop', sandbox.id),
        label: 'Cancel',
        variant: 'destructive',
        confirm: 'Stop this sandbox while it is still starting?',
      }];
    }
    return [];
  }
  const extend: GuestStatusAction = {
    kind: 'button',
    id: statusActionId('extend', sandbox.id),
    label: 'Extend 1h',
    variant: 'outline',
    disabled: !sandbox.archiveAfter && sandbox.ttlSeconds === null,
  };
  return [
    {
      kind: 'button',
      id: statusActionId('stop', sandbox.id),
      label: 'Stop',
      variant: 'destructive',
      confirm: 'Stop this sandbox?',
    },
    extend,
  ];
};

const desktopChip = (sandbox: Sandbox, desktopUrls: Map<string, string | null>): GuestStatusChip | null => {
  const url = desktopUrls.get(sandbox.id);
  if (!url || !isUpState(sandbox.state)) return null;
  return {
    id: clip(`desk-${sandbox.id.replace(/_/g, '-').toLowerCase()}`, ROW_ID_MAX),
    label: 'Desktop',
    url,
  };
};

type StatusViewInput = {
  sandboxes: Sandbox[];
  desktopUrls: Map<string, string | null>;
  agents: ReadonlySet<string>;
  failure: Failure | null;
  planNote: string | null;
  now: number;
};

const orderOf = (sandbox: Sandbox): number => {
  if (isUpState(sandbox.state)) return 0;
  if (isPendingState(sandbox.state)) return 1;
  if (isStoppedState(sandbox.state)) return 2;
  return 3;
};

export const buildStatusView = (input: StatusViewInput): GuestStatusView => {
  const notes: GuestStatusRow[] = [];

  if (input.failure) {
    notes.push({ kind: 'note', id: 'note-error', text: clip(input.failure.text, NOTE_MAX), tone: input.failure.tone });
  }

  if (!input.failure && input.sandboxes.length === 0) {
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
      const byAgent = Number(input.agents.has(right.id)) - Number(input.agents.has(left.id));
      if (byAgent !== 0) return byAgent;
      const byState = orderOf(left) - orderOf(right);
      if (byState !== 0) return byState;
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
