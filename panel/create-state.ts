/** The create form's shape, defaults, choice lists and the rules that block Create. */
import type {
  CreateOptionsResponse,
  CreateSandboxRequest,
  CreateSnapshot,
  CreateStartKind,
} from '../shared/routes.ts';
import type { SandboxSize, SandboxSummary } from '../shared/types.ts';

export const SIZE_LABELS: Record<SandboxSize, string> = {
  small: 'Small · 2 vCPU, 4 GB',
  default: 'Default · 4 vCPU, 8 GB',
  large: 'Large · 8 vCPU, 16 GB',
  xlarge: 'XLarge · 16 vCPU, 32 GB',
};

export type CreateForm = {
  start: CreateStartKind;
  snapshot: string | null;
  copyFrom: string | null;
  /** null means the account default, or the source's environment for a copy. */
  environment: string | null;
  /** null means the default size, or the source's size for a copy. */
  size: SandboxSize | null;
  name: string;
  autoStopHours: number;
};

export type CreateState = CreateForm & {
  open: boolean;
  loading: boolean;
  busy: boolean;
  options: CreateOptionsResponse | null;
};

export type Choice = { id: string; label: string; hint?: string };

export const initialCreateState = (): CreateState => ({
  open: false,
  loading: false,
  busy: false,
  options: null,
  start: 'clean',
  snapshot: null,
  copyFrom: null,
  environment: null,
  size: 'default',
  name: '',
  autoStopHours: 1,
});

export const folderName = (directory: string | null): string | null => {
  if (!directory) return null;
  const parts = directory.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? null;
};

export const defaultName = (directory: string | null, now = Date.now()): string => {
  const folder = folderName(directory);
  return folder ? `${folder} ${new Date(now).toISOString().slice(0, 10)}` : '';
};

export const copyName = (sandbox: SandboxSummary | null): string => (
  sandbox ? `${sandbox.name} copy` : ''
);

export const defaultEnvironment = (options: CreateOptionsResponse | null): string | null => (
  options?.suggestedEnvironment
  ?? options?.environments.find((environment) => environment.isDefault)?.name
  ?? options?.environments[0]?.name
  ?? null
);

export const defaultForm = (
  options: CreateOptionsResponse | null,
  directory: string | null,
  now = Date.now(),
): CreateForm => ({
  start: 'clean',
  snapshot: options?.snapshots[0]?.name ?? null,
  copyFrom: null,
  environment: defaultEnvironment(options),
  size: 'default',
  name: defaultName(directory, now),
  autoStopHours: 1,
});

export const hoursMax = (options: CreateOptionsResponse | null): number => (
  Math.max(1, options?.limits.autoStopMaxHours ?? 1)
);

export const formatBytes = (bytes: number | null): string => {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
};

export const snapshotHint = (snapshot: CreateSnapshot): string => {
  const size = formatBytes(snapshot.sizeBytes);
  const date = snapshot.createdAt ? snapshot.createdAt.slice(0, 10) : '';
  return [size, date].filter(Boolean).join(' · ');
};

export const startOptions = (
  options: CreateOptionsResponse | null,
  sandboxes: SandboxSummary[],
): Choice[] => {
  const noneSaved = options !== null && options.snapshots.length === 0;
  return [
    { id: 'clean', label: 'Clean machine' },
    { id: 'snapshot', label: 'Saved snapshot', ...(noneSaved ? { hint: 'none saved yet' } : {}) },
    { id: 'copy', label: 'Copy of a sandbox', ...(sandboxes.length === 0 ? { hint: 'none yet' } : {}) },
  ];
};

export const environmentOptions = (
  form: CreateForm,
  options: CreateOptionsResponse | null,
  sandboxes: SandboxSummary[],
): Choice[] => {
  const environments = (options?.environments ?? []).map((environment): Choice => ({
    id: environment.name,
    label: environment.name,
    ...(environment.isDefault ? { hint: 'default' } : {}),
  }));
  if (form.start !== 'copy') return environments;

  const source = sandboxes.find((sandbox) => sandbox.id === form.copyFrom) ?? null;
  const inherit = source
    ? `Same as ${source.name} (${source.environment ?? 'default'})`
    : 'Same as source';
  return [{ id: 'inherit', label: inherit }, ...environments];
};

export const sizeOptions = (form: CreateForm, options: CreateOptionsResponse | null): Choice[] => {
  const sizes = (options?.limits.sizes ?? []).map((size): Choice => ({
    id: size.id,
    label: SIZE_LABELS[size.id],
    ...(size.available ? {} : { hint: size.reason ?? 'not available on this plan' }),
  }));
  return form.start === 'copy' ? [{ id: 'source', label: 'Same as source' }, ...sizes] : sizes;
};

export const blockedReason = (
  form: CreateForm,
  options: CreateOptionsResponse | null,
  sandboxes: SandboxSummary[],
): string | null => {
  if (!options) return 'Sandbox options are still loading.';
  if (!options.limits.canStart) return options.limits.reason ?? 'The plan cannot start a sandbox right now.';

  const { active, maxActive } = options.limits;
  if (active !== null && maxActive !== null && active >= maxActive) {
    return `All ${maxActive} sandbox slots are in use. Stop one first.`;
  }

  if (form.start === 'snapshot') {
    if (options.snapshots.length === 0) return 'No saved snapshots yet. Save one with `boat snapshot <id> <name>`.';
    if (!form.snapshot || !options.snapshots.some((snapshot) => snapshot.name === form.snapshot)) {
      return 'Pick a snapshot.';
    }
  }

  if (form.start === 'copy') {
    if (sandboxes.length === 0) return 'No sandbox to copy yet.';
    if (!form.copyFrom || !sandboxes.some((sandbox) => sandbox.id === form.copyFrom)) {
      return 'Pick a sandbox to copy.';
    }
  } else {
    if (options.environments.length === 0) return 'No environments were read.';
    if (!form.environment) return 'Pick an environment.';
  }

  if (form.size) {
    const size = options.limits.sizes.find((entry) => entry.id === form.size);
    if (size && !size.available) return size.reason ?? `${form.size} is not available on this plan.`;
  }

  if (form.name.trim().length > 120) return 'That name is too long (120 characters).';
  if (!Number.isInteger(form.autoStopHours) || form.autoStopHours < 1) return 'Set at least 1 hour of auto-stop.';
  const max = hoursMax(options);
  if (form.autoStopHours > max) return `Auto-stop is capped at ${max} hours on this plan.`;

  return null;
};

export const createRequest = (form: CreateForm): CreateSandboxRequest => ({
  start: form.start === 'clean'
    ? { kind: 'clean' }
    : form.start === 'snapshot'
      ? { kind: 'snapshot', name: form.snapshot ?? '' }
      : { kind: 'copy', sandboxId: form.copyFrom ?? '' },
  environment: form.environment ?? undefined,
  size: form.size ?? undefined,
  name: form.name.trim() || undefined,
  autoStopHours: form.autoStopHours,
});
