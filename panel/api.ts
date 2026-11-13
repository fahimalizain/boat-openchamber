/** Typed wrappers around `host.serviceRequest`; the only place that knows routes. */
import type {
  ActionRequest,
  ActionResponse,
  ConversationsResponse,
  HistoryResponse,
  InterruptRequest,
  OkBody,
  PromptRequest,
  PromptResponse,
  SandboxesResponse,
  SteerRequest,
  WatchRequest,
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
  conversations: (sandboxId: string) => Promise<ConversationsResponse>;
  history: (sandboxId: string, conversationId: string) => Promise<HistoryResponse>;
  watch: (sandboxId: string, conversationId: string) => Promise<OkBody>;
  unwatch: (sandboxId: string, conversationId: string) => Promise<OkBody>;
  prompt: (request: PromptRequest) => Promise<PromptResponse>;
  steer: (request: SteerRequest) => Promise<OkBody>;
  interrupt: (request: InterruptRequest) => Promise<OkBody>;
  action: (request: ActionRequest) => Promise<ActionResponse>;
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
    conversations: (sandboxId) => call('GET', `/conversations${query({ sandbox: sandboxId })}`),
    history: (sandboxId, conversationId) => call(
      'GET',
      `/history${query({ sandbox: sandboxId, conversation: conversationId })}`,
    ),
    watch: (sandboxId, conversationId) => call('POST', '/watch', {
      sandbox: sandboxId,
      conversation: conversationId,
    } satisfies WatchRequest),
    unwatch: (sandboxId, conversationId) => call('POST', '/unwatch', {
      sandbox: sandboxId,
      conversation: conversationId,
    } satisfies WatchRequest),
    prompt: (request) => call('POST', '/prompt', request),
    steer: (request) => call('POST', '/steer', request),
    interrupt: (request) => call('POST', '/interrupt', request),
    action: (request) => call('POST', '/action', request),
  };
};
