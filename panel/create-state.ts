/** The create form's shape, its defaults, and the rules that block Create. */
import type { CreateOptionsResponse, CreateSandboxRequest, CreateSource } from '../shared/routes.ts';
import type { SandboxSize } from '../shared/types.ts';

export type CreateForm = {
  source: CreateSource;
  environment: string | null;
  snapshot: string | null;
  fork: string | null;
  type: SandboxSize;
  name: string;
  autoStopHours: number;
};

export type CreateState = CreateForm & {
  open: boolean;
  loading: boolean;
  busy: boolean;
  options: CreateOptionsResponse | null;
};

export const initialCreateState = (): CreateState => ({
  open: false,
  loading: false,
  busy: false,
  options: null,
  source: 'environment',
  environment: null,
  snapshot: null,
  fork: null,
  type: 'default',
  name: '',
  autoStopHours: 1,
});

export const folderName = (directory: string | null): string | null => {
  if (!directory) return null;
  const parts = directory.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? null;
};

export const defaultForm = (
  options: CreateOptionsResponse | null,
  directory: string | null,
  now = Date.now(),
): CreateForm => {
  const folder = folderName(directory);
  const suggested = options?.suggestedEnvironment
    ?? options?.environments.find((environment) => environment.isDefault)?.name
    ?? options?.environments[0]?.name
    ?? null;

  return {
    source: 'environment',
    environment: suggested,
    snapshot: options?.snapshots[0]?.name ?? null,
    fork: null,
    type: 'default',
    name: folder ? `${folder} ${new Date(now).toISOString().slice(0, 10)}` : '',
    autoStopHours: 1,
  };
};

export const hoursMax = (options: CreateOptionsResponse | null): number => (
  Math.max(1, options?.limits.autoStopMaxHours ?? 1)
);

export const blockedReason = (
  form: CreateForm,
  options: CreateOptionsResponse | null,
): string | null => {
  if (!options) return 'Sandbox options are still loading.';
  if (!options.limits.canStart) return options.limits.reason ?? 'The plan cannot start a sandbox right now.';

  const { active, maxActive } = options.limits;
  if (active !== null && maxActive !== null && active >= maxActive) {
    return `All ${maxActive} sandbox slots are in use. Stop one first.`;
  }

  if (form.source === 'environment' && !form.environment) return 'Pick an environment.';
  if (form.source === 'snapshot' && !form.snapshot) return 'Pick a saved snapshot.';
  if (form.source === 'fork' && !form.fork) return 'Pick a sandbox to fork.';

  const size = options.limits.sizes.find((entry) => entry.id === form.type);
  if (size && !size.available) return size.reason ?? `${form.type} is not available on this plan.`;

  if (form.name.trim().length > 120) return 'That name is too long (120 characters).';
  if (!Number.isInteger(form.autoStopHours) || form.autoStopHours < 1) return 'Set at least 1 hour of auto-stop.';
  const max = hoursMax(options);
  if (form.autoStopHours > max) return `Auto-stop is capped at ${max} hours on this plan.`;

  return null;
};

export const createRequest = (form: CreateForm): CreateSandboxRequest => ({
  source: form.source,
  ...(form.source === 'environment' ? { environment: form.environment ?? undefined } : {}),
  ...(form.source === 'snapshot' ? { snapshot: form.snapshot ?? undefined } : {}),
  ...(form.source === 'fork' ? { fork: form.fork ?? undefined } : {}),
  type: form.type,
  ...(form.source === 'fork' ? {} : { name: form.name.trim() || undefined }),
  autoStopHours: form.autoStopHours,
});

export type SizeOption = { id: SandboxSize; label: string; hint?: string };

/** Every size, with the plan's reason on the blocked ones. */
export const sizeOptions = (options: CreateOptionsResponse | null): SizeOption[] => (
  (options?.limits.sizes ?? []).map((size) => ({
    id: size.id,
    label: size.id,
    ...(size.available ? {} : { hint: size.reason ?? 'not available on this plan' }),
  }))
);
