/** The one shape of a sandbox, a conversation and an agent event both sides use. */

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
};

/** What the panel picker needs, without the fields only the service uses. */
export type SandboxSummary = Pick<
  Sandbox,
  'id' | 'name' | 'state' | 'type' | 'vcpu' | 'memoryGB' | 'environment' | 'ttlSeconds' | 'archiveAfter' | 'stoppedAt' | 'desktopAvailable'
>;

export type Conversation = {
  id: string;
  createdAt: string | null;
  lastPromptAt: string | null;
  prompts: number;
  running: boolean;
  lastHarness: string | null;
  lastModel: string | null;
  lastPromptPreview: string | null;
  current: boolean;
};

export type UiTool = {
  name: string;
  /** One line: a shell command, a path, or a short JSON preview. */
  detail: string;
  isError: boolean;
};

export type UiEvent = {
  id: string;
  type: string;
  role: 'user' | 'assistant' | 'system';
  /** Epoch milliseconds. */
  at: number;
  text: string;
  streaming: boolean;
  model: string | null;
  status: string | null;
  tools: UiTool[];
  error: string | null;
  conversationId: string | null;
};

/** Every action the panel and the sandbox row can ask for. */
export type SandboxAction = 'stop' | 'resume' | 'extend' | 'desktop';

/** The actions the status section offers, which are the ones a CLI command names. */
export type SandboxActionVerb = 'stop' | 'resume' | 'extend';

export const isUpState = (state: string): boolean => (
  state === 'ready' || state === 'idle' || state === 'running'
);

export const isBootingState = (state: string): boolean => (
  state === 'provisioned' || state === 'cloning'
);

export const isPendingState = (state: string): boolean => isBootingState(state) || state === 'stopping';

export const isStoppedState = (state: string): boolean => state === 'stopped';
