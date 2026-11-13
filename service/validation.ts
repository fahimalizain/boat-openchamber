/** The ids and sizes the service accepts from the panel. */

export const SANDBOX_ID = /^[a-z]{2,8}_[a-z0-9]{4,40}$/;
export const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const MAX_PROMPT_CHARS = 20_000;
export const MAX_MODEL_CHARS = 200;

export const isSandboxId = (value: unknown): value is string => (
  typeof value === 'string' && SANDBOX_ID.test(value)
);

export const isConversationId = (value: unknown): value is string => (
  typeof value === 'string' && CONVERSATION_ID.test(value)
);
