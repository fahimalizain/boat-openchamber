/** Opening, loading and submitting the create form, and the progress it reports. */
import { isRecord } from '../shared/json.ts';
import type { CreateSandboxRequest, CreateStartKind } from '../shared/routes.ts';
import { isSandboxSize, type SandboxSummary } from '../shared/types.ts';
import type { ServiceClient } from './api.ts';
import {
  blockedReason,
  copyName,
  createRequest,
  defaultEnvironment,
  defaultForm,
  defaultName,
  type CreateState,
} from './create-state.ts';
import type { Cell, Reporter } from './state.ts';

export type CreateActions = {
  openCreate: (start?: CreateStartKind, copyFrom?: string | null) => void;
  closeCreate: () => void;
  setCreateStart: (start: CreateStartKind) => void;
  setCreateSnapshot: (name: string) => void;
  setCreateCopy: (sandboxId: string) => void;
  setCreateEnvironment: (environment: string) => void;
  setCreateSize: (value: string) => void;
  setCreateName: (name: string) => void;
  setCreateHours: (hours: number) => void;
  submitCreate: () => Promise<void>;
  handleCreateProgress: (data: unknown) => void;
};

export const createCreateActions = (deps: {
  cell: Cell;
  client: ServiceClient;
  toast: (kind: 'info' | 'success' | 'error', message: string) => void;
  reporter: Reporter;
  refreshSandboxes: () => Promise<void>;
  selectSandbox: (sandboxId: string) => Promise<void>;
}): CreateActions => {
  const set = (patch: Partial<CreateState>): void => {
    const current = deps.cell.get().create;
    deps.cell.patch({ create: { ...current, ...patch } });
  };

  const sourceOf = (sandboxId: string | null): SandboxSummary | null => (
    sandboxId ? deps.cell.get().sandboxes.find((sandbox) => sandbox.id === sandboxId) ?? null : null
  );

  const loadOptions = async (start: CreateStartKind, copyFrom: string | null): Promise<void> => {
    const directory = deps.cell.get().directory;
    set({ open: true, loading: true, start, copyFrom });
    try {
      const options = await deps.client.createOptions(directory);
      const form = defaultForm(options, directory);
      const state = deps.cell.get();
      const copyId = copyFrom ?? state.sandboxId ?? state.sandboxes[0]?.id ?? null;
      const copySource = start === 'copy' ? sourceOf(copyId) : null;

      set({
        ...form,
        start,
        copyFrom: start === 'copy' ? copySource?.id ?? null : null,
        environment: start === 'copy' ? null : form.environment,
        size: start === 'copy' ? null : form.size,
        name: start === 'copy'
          ? copyName(copySource)
          : start === 'snapshot'
            ? (form.snapshot ?? '')
            : form.name,
        options,
        loading: false,
        busy: false,
      });
    } catch (failure) {
      set({ loading: false, options: null });
      deps.reporter.fail('Could not read what a sandbox needs', failure);
    }
  };

  const openCreate = (start: CreateStartKind = 'clean', copyFrom: string | null = null): void => {
    void loadOptions(start, copyFrom);
  };

  const setCreateStart = (start: CreateStartKind): void => {
    const state = deps.cell.get();
    const create = state.create;
    const options = create.options;

    if (start === 'copy') {
      const copyFrom = create.copyFrom
        ?? (state.sandboxes.some((sandbox) => sandbox.id === state.sandboxId) ? state.sandboxId : null)
        ?? state.sandboxes[0]?.id
        ?? null;
      set({ start, copyFrom, environment: null, size: null, name: copyName(sourceOf(copyFrom)) });
      return;
    }

    const environment = create.environment ?? defaultEnvironment(options);
    const size = create.size ?? 'default';

    if (start === 'snapshot') {
      const snapshot = create.snapshot ?? options?.snapshots[0]?.name ?? null;
      set({ start, environment, size, snapshot, name: snapshot ?? '' });
      return;
    }

    set({ start, environment, size, name: defaultName(state.directory) });
  };

  const submitCreate = async (): Promise<void> => {
    const { create, sandboxes } = deps.cell.get();
    if (create.busy || create.loading) return;

    const blocked = blockedReason(create, create.options, sandboxes);
    if (blocked) {
      deps.toast('info', blocked);
      return;
    }

    set({ busy: true });
    try {
      const request: CreateSandboxRequest = createRequest(create);
      await deps.client.create(request);
      deps.toast('info', 'Creating the sandbox…');
    } catch (failure) {
      set({ busy: false });
      deps.reporter.fail('The sandbox was not created', failure);
    }
  };

  const handleCreateProgress = (data: unknown): void => {
    if (!isRecord(data)) return;
    const phase = typeof data.state === 'string' ? data.state : '';
    const sandboxId = typeof data.sandboxId === 'string' ? data.sandboxId : null;
    const message = typeof data.message === 'string' ? data.message : null;

    if (phase === 'starting') return;
    if (phase === 'created') {
      set({ busy: true });
      return;
    }
    if (phase === 'failed') {
      set({ busy: false });
      deps.reporter.fail('The sandbox was not created', new Error(message ?? 'boat did not create it.'));
      return;
    }
    if (phase !== 'ready') return;

    set({ busy: false, open: false });
    if (message) {
      deps.reporter.setBanner({
        tone: 'warning',
        title: 'The sandbox is ready, but was not renamed',
        body: message,
      });
    }
    deps.toast('success', 'Sandbox is ready.');
    void (async () => {
      try {
        await deps.refreshSandboxes();
        if (sandboxId) await deps.selectSandbox(sandboxId);
      } catch {
        // The next sandbox refresh picks it up.
      }
    })();
  };

  return {
    openCreate,
    closeCreate: () => set({ open: false }),
    setCreateStart,
    setCreateSnapshot: (name) => set({ snapshot: name, name }),
    setCreateCopy: (sandboxId) => set({ copyFrom: sandboxId, name: copyName(sourceOf(sandboxId)) }),
    setCreateEnvironment: (environment) => set({ environment: environment === 'inherit' ? null : environment }),
    setCreateSize: (value) => set({ size: value === 'source' ? null : isSandboxSize(value) ? value : null }),
    setCreateName: (name) => set({ name }),
    setCreateHours: (hours) => set({ autoStopHours: Number.isFinite(hours) ? hours : 0 }),
    submitCreate,
    handleCreateProgress,
  };
};
