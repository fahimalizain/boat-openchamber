/** The sandbox shape both sides use, plus its state and action vocabularies. */

export type Sandbox = {
  id: string;
  name: string;
  state: string;
  /** Machine type: small, default, large or xlarge. */
  type: string | null;
  vcpu: number | null;
  memoryGB: number | null;
  createdAt: string | null;
  /** When the current lifetime runs out; null when it never auto-stops. */
  archiveAfter: string | null;
  stoppedAt: string | null;
  url: string | null;
  ttlSeconds: number | null;
  desktopAvailable: boolean;
  environment: string | null;
  health: string | null;
  sshEndpoint: string | null;
  /** Free-form labels set at create or fork, used to pin a sandbox to a project. */
  labels: Record<string, string>;
};

/** What the panel picker needs, without the fields only the service uses. */
export type SandboxSummary = Pick<
  Sandbox,
  'id' | 'name' | 'state' | 'type' | 'vcpu' | 'memoryGB' | 'environment' | 'ttlSeconds' | 'archiveAfter' | 'stoppedAt' | 'desktopAvailable'
>;

/** How a sandbox was tied to an OpenChamber project, in priority order. */
export type ProjectMatch = 'label' | 'repo' | 'name';

/** Every action the panel and the sandbox row can ask for. */
export type SandboxAction = 'stop' | 'resume' | 'extend' | 'desktop' | 'opencode';

/** The actions the status section offers, which are the ones a CLI command names. */
export type SandboxActionVerb = 'stop' | 'resume' | 'extend';

export type SandboxSize = 'small' | 'default' | 'large' | 'xlarge';

export const SANDBOX_SIZES: readonly SandboxSize[] = ['small', 'default', 'large', 'xlarge'];

export const isSandboxSize = (value: string): value is SandboxSize => (
  (SANDBOX_SIZES as readonly string[]).includes(value)
);

export const isUpState = (state: string): boolean => (
  state === 'ready' || state === 'idle' || state === 'running'
);

export const isBootingState = (state: string): boolean => (
  state === 'provisioned' || state === 'cloning'
);

export const isPendingState = (state: string): boolean => isBootingState(state) || state === 'stopping';

export const isStoppedState = (state: string): boolean => state === 'stopped';
