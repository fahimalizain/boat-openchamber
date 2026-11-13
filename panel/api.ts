/** Typed wrappers around `host.serviceRequest`; the only place that knows routes. */
import type {
  ActionRequest,
  ActionResponse,
  CreateOptionsResponse,
  CreateSandboxRequest,
  CreateSandboxResponse,
  OkBody,
  OpencodeAbortRequest,
  OpencodeAbortResponse,
  OpencodeCatalogResponse,
  OpencodeCreateSessionRequest,
  OpencodeMessagesResponse,
  OpencodePermissionReplyRequest,
  OpencodePromptRequest,
  OpencodePromptResponse,
  OpencodeQuestionReplyRequest,
  OpencodeSessionResponse,
  OpencodeSessionsResponse,
  ProjectsRequest,
  SandboxesResponse,
} from '../shared/routes.ts';

export type HostRequester = {
  serviceRequest: (request: {
    method: 'GET' | 'POST';
    path: string;
    body?: string;
  }) => Promise<{ status: number; body: string }>;
};

export type ServiceClient = {
  sandboxes: (directory: string | null) => Promise<SandboxesResponse>;
  action: (request: ActionRequest) => Promise<ActionResponse>;
  createOptions: (directory: string | null) => Promise<CreateOptionsResponse>;
  create: (request: CreateSandboxRequest) => Promise<CreateSandboxResponse>;
  rememberProjects: (directories: string[]) => Promise<OkBody>;
  sessions: (sandboxId: string, directory: string | null) => Promise<OpencodeSessionsResponse>;
  messages: (sandboxId: string, sessionId: string) => Promise<OpencodeMessagesResponse>;
  catalog: (sandboxId: string) => Promise<OpencodeCatalogResponse>;
  createSession: (request: OpencodeCreateSessionRequest) => Promise<OpencodeSessionResponse>;
  prompt: (request: OpencodePromptRequest) => Promise<OpencodePromptResponse>;
  abort: (request: OpencodeAbortRequest) => Promise<OpencodeAbortResponse>;
  permission: (request: OpencodePermissionReplyRequest) => Promise<OkBody>;
  question: (request: OpencodeQuestionReplyRequest) => Promise<OkBody>;
  watch: (sandboxId: string) => Promise<OkBody>;
  unwatch: (sandboxId: string) => Promise<OkBody>;
};

const query = (values: Record<string, string>): string => `?${new URLSearchParams(values).toString()}`;

export const createServiceClient = (host: HostRequester): ServiceClient => {
  const call = async <T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T> => {
    const answer = await host.serviceRequest({
      method,
      path,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });

    let parsed: unknown = {};
    try {
      parsed = JSON.parse(answer.body || '{}');
    } catch {
      parsed = {};
    }
    if (answer.status < 200 || answer.status >= 300) {
      const message = typeof parsed === 'object' && parsed !== null && 'error' in parsed
        && typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `Boat answered HTTP ${answer.status}.`;
      throw new Error(message);
    }
    return parsed as T;
  };

  return {
    sandboxes: (directory) => call(
      'GET',
      directory ? `/sandboxes${query({ directory })}` : '/sandboxes',
    ),
    action: (request) => call('POST', '/action', request),
    createOptions: (directory) => call(
      'GET',
      directory ? `/create-options${query({ directory })}` : '/create-options',
    ),
    create: (request) => call('POST', '/create', request),
    rememberProjects: (directories) => call('POST', '/projects', {
      directories,
    } satisfies ProjectsRequest),
    sessions: (sandboxId, directory) => call('GET', `/opencode/sessions${query(directory
      ? { sandbox: sandboxId, directory }
      : { sandbox: sandboxId })}`),
    messages: (sandboxId, sessionId) => call(
      'GET',
      `/opencode/messages${query({ sandbox: sandboxId, session: sessionId })}`,
    ),
    catalog: (sandboxId) => call('GET', `/opencode/catalog${query({ sandbox: sandboxId })}`),
    createSession: (request) => call('POST', '/opencode/session', request),
    prompt: (request) => call('POST', '/opencode/prompt', request),
    abort: (request) => call('POST', '/opencode/abort', request),
    permission: (request) => call('POST', '/opencode/permission', request),
    question: (request) => call('POST', '/opencode/question', request),
    watch: (sandboxId) => call('POST', '/opencode/watch', { sandbox: sandboxId }),
    unwatch: (sandboxId) => call('POST', '/opencode/unwatch', { sandbox: sandboxId }),
  };
};
