/** Opening, loading and submitting the create form, and the progress it reports. */
import { isRecord } from '../shared/json.ts';
import type { CreateSandboxRequest, CreateSource } from '../shared/routes.ts';
import type { ServiceClient } from './api.ts';
import { blockedReason, createRequest, defaultForm, type CreateState } from './create-state.ts';
import type { Cell, Reporter } from './state.ts';

export type CreateActions = {
  openCreate: (source?: CreateSource, forkId?: string | null) => void;
  closeCreate: () => void;
  setCreate: (patch: Partial<CreateState>) => void;
  setCreateSource: (source: CreateSource) => void;
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

  const loadOptions = async (source: CreateSource, forkId: string | null): Promise<void> => {
    const directory = deps.cell.get().directory;
    set({ open: true, loading: true, source, fork: forkId });
    try {
      const options = await deps.client.createOptions(directory);
      const form = defaultForm(options, directory);
      set({
        ...form,
        source,
        fork: forkId ?? form.fork,
        options,
        loading: false,
        busy: false,
      });
    } catch (failure) {
      set({ loading: false, options: null });
      deps.reporter.fail('Could not read what a sandbox needs', failure);
    }
  };

  const openCreate = (source: CreateSource = 'environment', forkId: string | null = null): void => {
    void loadOptions(source, forkId);
  };

  const setCreateSource = (source: CreateSource): void => {
    const state = deps.cell.get();
    const create = state.create;
    const patch: Partial<CreateState> = { source };

    if (source === 'environment' && !create.environment) {
      patch.environment = create.options?.suggestedEnvironment ?? create.options?.environments[0]?.name ?? null;
    }
    if (source === 'snapshot' && !create.snapshot) {
      patch.snapshot = create.options?.snapshots[0]?.name ?? null;
    }
    if (source === 'fork' && !create.fork) {
      patch.fork = state.sandboxId ?? state.sandboxes[0]?.id ?? null;
    }
    set(patch);
  };

  const submitCreate = async (): Promise<void> => {
    const { create } = deps.cell.get();
    if (create.busy || create.loading) return;

    const blocked = blockedReason(create, create.options);
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
    setCreate: set,
    setCreateSource,
    submitCreate,
    handleCreateProgress,
  };
};
